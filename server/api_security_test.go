package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func oversizedMultipartRequest(t *testing.T) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormField("systemLabel")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes.Repeat([]byte("a"), int(maxUploadFieldBytes+1))); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestUploadHandlersRejectOversizedMultipartField(t *testing.T) {
	controller := &Controller{
		Apikeys: NewApikeys(),
		Logs:    NewLogs(),
	}
	api := NewApi(controller)

	tests := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{name: "call upload", handler: api.CallUploadHandler},
		{name: "trunk recorder upload", handler: api.TrunkRecorderCallUploadHandler},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			test.handler(response, oversizedMultipartRequest(t))

			if response.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusRequestEntityTooLarge, response.Body.String())
			}
		})
	}
}

func TestUploadHandlersRejectOversizedRequestFromContentLength(t *testing.T) {
	controller := &Controller{
		Apikeys: NewApikeys(),
		Logs:    NewLogs(),
	}
	api := NewApi(controller)

	for _, handler := range []http.HandlerFunc{api.CallUploadHandler, api.TrunkRecorderCallUploadHandler} {
		request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(nil))
		request.Header.Set("Content-Type", "multipart/form-data; boundary=test")
		request.ContentLength = maxUploadRequestBytes + 1
		response := httptest.NewRecorder()

		handler(response, request)

		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
		}
	}
}
