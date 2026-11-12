package main

// Broker input is a single, exact-purpose, short-lived request. The browser
// never chooses a command, executable, target directory, or update feed.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

func parseNativeBrokerRequest(raw []byte, now time.Time) (authorizedServerUpdateRequest, error) {
	var request authorizedServerUpdateRequest
	if len(raw) == 0 || len(raw) > 4096 {
		return request, errors.New("broker request exceeds fixed size bounds")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, errors.New("broker request is malformed")
	}
	var tail any
	if err := decoder.Decode(&tail); !errors.Is(err, io.EOF) {
		return request, errors.New("broker request has trailing data")
	}
	if request.Schema != 1 || request.Action != "install-signed-server-update" ||
		request.Channel != "main" || !serverUpdateIDPattern.MatchString(request.TransactionID) ||
		request.Release == "" || len(request.Release) > 80 || request.Sequence <= 0 {
		return request, errors.New("broker request identity or action is invalid")
	}
	created, err := time.Parse(time.RFC3339Nano, request.CreatedAt)
	if err != nil || created.After(now.Add(15*time.Second)) ||
		now.Sub(created) > 2*time.Minute {
		return request, errors.New("broker request is expired or future-dated")
	}
	for _, digest := range []string{request.InstallerSHA256, request.ConfigSHA256} {
		data, err := hex.DecodeString(digest)
		if err != nil || len(data) != sha256.Size {
			return request, errors.New("broker request digest is invalid")
		}
	}
	return request, nil
}
