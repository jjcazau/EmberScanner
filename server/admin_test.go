package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

func TestAdminRejectsExpiredAndNonExpiringTokens(t *testing.T) {
	admin := newAdminTestController(t).Admin

	for name, claims := range map[string]jwt.RegisteredClaims{
		"expired":      {ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))},
		"non-expiring": {},
	} {
		t.Run(name, func(t *testing.T) {
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(admin.Controller.Options.secret))
			if err != nil {
				t.Fatal(err)
			}
			admin.addToken(token)
			if admin.ValidateToken(token) {
				t.Fatal("invalid-lifetime token was accepted")
			}
		})
	}
}

func newAdminTestController(t *testing.T) *Controller {
	t.Helper()
	controller := newUnitIngestController(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	controller.Options.adminPassword = string(hash)
	controller.Options.secret = "admin-test-secret"
	return controller
}

func adminLogin(t *testing.T, admin *Admin, password, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"password": password})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/admin/login", bytes.NewReader(body))
	request.RemoteAddr = remoteAddr
	response := httptest.NewRecorder()
	admin.LoginHandler(response, request)
	return response
}

func tokenFromLogin(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Token == "" {
		t.Fatal("login response did not contain a token")
	}
	return body.Token
}

func TestAdminLoginAllowsFirstValidAttemptAndResetsFailures(t *testing.T) {
	admin := newAdminTestController(t).Admin

	if response := adminLogin(t, admin, "wrong", "192.0.2.10:1234"); response.Code != http.StatusUnauthorized {
		t.Fatalf("failed login status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	response := adminLogin(t, admin, "correct-password", "192.0.2.10:4321")
	if response.Code != http.StatusOK {
		t.Fatalf("valid login status = %d, want %d", response.Code, http.StatusOK)
	}

	admin.stateMutex.RLock()
	_, exists := admin.Attempts["192.0.2.10"]
	admin.stateMutex.RUnlock()
	if exists {
		t.Fatal("successful login did not reset failed attempts")
	}
}

func TestAdminLoginLocksAtMaximumAndExpires(t *testing.T) {
	admin := newAdminTestController(t).Admin
	admin.AttemptsMax = 3
	admin.AttemptsMaxDelay = time.Minute
	remoteAddr := "192.0.2.20:1234"

	for i := 0; i < 3; i++ {
		if response := adminLogin(t, admin, "wrong", remoteAddr); response.Code != http.StatusUnauthorized {
			t.Fatalf("failed login %d status = %d", i+1, response.Code)
		}
	}
	if response := adminLogin(t, admin, "correct-password", remoteAddr); response.Code != http.StatusUnauthorized {
		t.Fatalf("locked login status = %d, want %d", response.Code, http.StatusUnauthorized)
	}

	admin.stateMutex.Lock()
	admin.Attempts["192.0.2.20"].Date = time.Now().Add(-2 * admin.AttemptsMaxDelay)
	admin.stateMutex.Unlock()
	if response := adminLogin(t, admin, "correct-password", remoteAddr); response.Code != http.StatusOK {
		t.Fatalf("login after lock expiry status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestAdminConfigWebSocketRegistersOnlyAfterAuthentication(t *testing.T) {
	controller := newAdminTestController(t)
	admin := controller.Admin
	if err := admin.Start(); err != nil {
		t.Fatal(err)
	}
	login := adminLogin(t, admin, "correct-password", "192.0.2.30:1234")
	token := tokenFromLogin(t, login)

	server := httptest.NewServer(http.HandlerFunc(admin.ConfigHandler))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	admin.BroadcastConfig()
	if err := conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("unauthenticated WebSocket received configuration")
	}

	// A client-side timeout makes this connection unsuitable for another read,
	// so authenticate a fresh connection and confirm it can be registered.
	conn.Close()
	conn, _, err = websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteMessage(websocket.TextMessage, []byte(token)); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(time.Second)
	for len(admin.connections()) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := len(admin.connections()); got != 1 {
		t.Fatalf("authenticated connection count = %d, want 1", got)
	}

	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	admin.BroadcastConfig()
	if messageType, _, err := conn.ReadMessage(); err != nil || messageType != websocket.TextMessage {
		t.Fatalf("authenticated WebSocket did not receive configuration: type=%d err=%v", messageType, err)
	}
}

func TestAdminConfigWebSocketRejectsOversizedAuthentication(t *testing.T) {
	admin := newAdminTestController(t).Admin
	server := httptest.NewServer(http.HandlerFunc(admin.ConfigHandler))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, bytes.Repeat([]byte("x"), adminWebSocketReadLimit+1)); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("oversized authentication frame was accepted")
	}
	if got := len(admin.connections()); got != 0 {
		t.Fatalf("oversized authentication registered %d connections", got)
	}
}

func TestAdminTokenAndAttemptStateIsConcurrencySafe(t *testing.T) {
	admin := newAdminTestController(t).Admin
	var workers sync.WaitGroup
	for i := 0; i < 32; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for j := 0; j < 100; j++ {
				token := "not-a-jwt"
				admin.addToken(token)
				admin.ValidateToken(token)
				admin.removeToken(token)
				admin.recordFailedLogin("192.0.2.40", time.Now())
				admin.loginLocked("192.0.2.40", time.Now())
				admin.clearLoginAttempt("192.0.2.40")
			}
		}()
	}
	workers.Wait()

	admin.stateMutex.RLock()
	defer admin.stateMutex.RUnlock()
	if len(admin.Tokens) > 5 {
		t.Fatalf("token count = %d, want at most 5", len(admin.Tokens))
	}
}
