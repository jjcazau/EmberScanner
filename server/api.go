// Copyright (C) 2019-2026 Chrystian Huot <chrystian.huot@saubeo.solutions>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>
//
// WebSocket API Access Policy:
// This WebSocket API is reserved exclusively for Saubeo Solutions and its native applications.
// Unauthorized access is strictly prohibited.
// See API_ACCESS_POLICY.md for full terms.

package main

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
)

const (
	maxUploadAudioBytes   int64 = 64 << 20
	maxUploadFieldBytes   int64 = 1 << 20
	maxUploadKeyBytes     int64 = 4 << 10
	maxUploadRequestBytes int64 = maxUploadAudioBytes + (4 << 20)
	maxUploadParts              = 64
)

var errUploadTooLarge = errors.New("upload exceeds the maximum allowed size")

type Api struct {
	Controller *Controller
}

func NewApi(controller *Controller) *Api {
	return &Api{Controller: controller}
}

func uploadPartLimit(formName string) int64 {
	switch formName {
	case "audio":
		return maxUploadAudioBytes
	case "key":
		return maxUploadKeyBytes
	default:
		return maxUploadFieldBytes
	}
}

func readUploadPart(part *multipart.Part) ([]byte, error) {
	limit := uploadPartLimit(part.FormName())
	b, err := io.ReadAll(io.LimitReader(part, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("%w: multipart field %q exceeds the %d byte limit", errUploadTooLarge, part.FormName(), limit)
	}
	return b, nil
}

func (api *Api) prepareMultipartUpload(w http.ResponseWriter, r *http.Request) (*multipart.Reader, bool) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		api.exitWithError(w, http.StatusBadRequest, "Invalid content-type")
		return nil, false
	}
	if !strings.HasPrefix(mediaType, "multipart/") || params["boundary"] == "" {
		api.exitWithError(w, http.StatusBadRequest, "Not a multipart content")
		return nil, false
	}
	if r.ContentLength > maxUploadRequestBytes {
		api.exitWithError(w, http.StatusRequestEntityTooLarge, "Upload exceeds the maximum allowed size")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadRequestBytes)
	return multipart.NewReader(r.Body, params["boundary"]), true
}

func (api *Api) exitWithMultipartError(w http.ResponseWriter, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) || errors.Is(err, errUploadTooLarge) {
		api.exitWithError(w, http.StatusRequestEntityTooLarge, "Upload exceeds the maximum allowed size")
		return
	}
	api.exitWithError(w, http.StatusExpectationFailed, fmt.Sprintf("multipart: %s", err.Error()))
}

func (api *Api) CallUploadHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var (
			call = NewCall()
			key  string
		)

		mr, ok := api.prepareMultipartUpload(w, r)
		if !ok {
			return
		}

		for partCount := 0; ; {
			p, err := mr.NextPart()
			if err == io.EOF {
				break
			} else if err != nil {
				api.exitWithMultipartError(w, err)
				return
			}
			partCount++
			if partCount > maxUploadParts {
				api.exitWithMultipartError(w, errUploadTooLarge)
				return
			}

			b, err := readUploadPart(p)
			if err != nil {
				api.exitWithMultipartError(w, err)
				return
			}

			switch p.FormName() {
			case "key":
				key = string(b)
				if _, ok := api.Controller.Apikeys.GetApikey(key); !ok {
					api.exitWithError(w, http.StatusUnauthorized, "Invalid API key")
					return
				}
			default:
				ParseMultipartContent(call, p, b)
			}
		}

		if ok, err := call.IsValid(); ok {
			api.HandleCall(key, call, w)
		} else {
			api.exitWithError(w, http.StatusExpectationFailed, fmt.Sprintf("Incomplete call data: %s\n", err.Error()))
		}

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte("Unsupported method\n"))
	}
}

func (api *Api) HandleCall(key string, call *Call, w http.ResponseWriter) {
	msg := []byte(fmt.Sprintf("Invalid API key for system %v talkgroup %v.\n", call.System, call.Talkgroup))

	if apikey, ok := api.Controller.Apikeys.GetApikey(key); ok {
		if apikey.HasAccess(call) {
			api.Controller.Ingest <- call

		} else {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write(msg)
			return
		}

	} else {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write(msg)
		return
	}

	w.Write([]byte("Call imported successfully.\n"))
}

func (api *Api) TrunkRecorderCallUploadHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var (
			call = NewCall()
			key  string
		)

		mr, ok := api.prepareMultipartUpload(w, r)
		if !ok {
			return
		}

		parts := map[*multipart.Part][]byte{}

		for partCount := 0; ; {
			p, err := mr.NextPart()
			if err == io.EOF {
				break
			} else if err != nil {
				api.exitWithMultipartError(w, err)
				return
			}
			partCount++
			if partCount > maxUploadParts {
				api.exitWithMultipartError(w, errUploadTooLarge)
				return
			}

			b, err := readUploadPart(p)
			if err != nil {
				api.exitWithMultipartError(w, err)
				return
			}

			switch p.FormName() {
			case "key":
				key = string(b)
				if _, ok := api.Controller.Apikeys.GetApikey(key); !ok {
					api.exitWithError(w, http.StatusUnauthorized, "Invalid API key")
					return
				}
			case "meta":
				if err := ParseTrunkRecorderMeta(call, b); err != nil {
					api.exitWithError(w, http.StatusExpectationFailed, "Invalid call data")
					return
				}
			default:
				parts[p] = b
			}
		}

		for p, b := range parts {
			ParseMultipartContent(call, p, b)
		}

		if ok, err := call.IsValid(); ok {
			api.HandleCall(key, call, w)

		} else {
			api.exitWithError(w, http.StatusExpectationFailed, fmt.Sprintf("Incomplete call data: %s\n", err.Error()))
		}

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte("Unsupported method\n"))
	}
}

func (api *Api) exitWithError(w http.ResponseWriter, status int, message string) {
	api.Controller.Logs.LogEvent(LogLevelError, fmt.Sprintf("api: %s", message))

	w.WriteHeader(status)
	w.Write([]byte(fmt.Sprintf("%s\n", message)))
}
