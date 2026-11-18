package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The web client is about 1.6 MB of JavaScript and CSS uncompressed and about
// 400 KB gzipped. The API process compresses its own responses, but static
// files are served here, so without this every first load over Wi-Fi, VPN or
// remote access transferred the full uncompressed bundle.

const (
	webCompressionMinBytes   = 1024
	webCompressionCacheBytes = 64 << 20
)

var webCompressibleExtensions = map[string]bool{
	".js": true, ".mjs": true, ".css": true, ".html": true, ".json": true, ".map": true,
	".svg": true, ".txt": true, ".xml": true, ".webmanifest": true, ".wasm": true,
}

type compressedWebAsset struct {
	modTime time.Time
	size    int64
	data    []byte
}

type webCompressionCache struct {
	mu    sync.Mutex
	items map[string]compressedWebAsset
	total int
}

var webGzipCache = &webCompressionCache{items: map[string]compressedWebAsset{}}

func webAssetCompressible(name string, size int64) bool {
	return size >= webCompressionMinBytes && webCompressibleExtensions[strings.ToLower(filepath.Ext(name))]
}

// acceptsGzip reports whether the client accepts gzip, honouring an explicit q=0.
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		coding := strings.ToLower(strings.TrimSpace(fields[0]))
		if coding != "gzip" && coding != "*" {
			continue
		}
		rejected := false
		for _, param := range fields[1:] {
			param = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(param)), " ", "")
			if param == "q=0" || param == "q=0.0" || param == "q=0.00" || param == "q=0.000" {
				rejected = true
			}
		}
		if !rejected {
			return true
		}
	}
	return false
}

// gzipped returns compressed bytes for the file, reusing a cached copy while the
// file's size and modification time are unchanged.
func (cache *webCompressionCache) gzipped(path string, info os.FileInfo) ([]byte, error) {
	cache.mu.Lock()
	if item, ok := cache.items[path]; ok && item.size == info.Size() && item.modTime.Equal(info.ModTime()) {
		cache.mu.Unlock()
		return item.data, nil
	}
	cache.mu.Unlock()

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := writer.Write(raw); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	data := buffer.Bytes()

	cache.mu.Lock()
	defer cache.mu.Unlock()
	if previous, ok := cache.items[path]; ok {
		cache.total -= len(previous.data)
		delete(cache.items, path)
	}
	// Built assets are content-hashed and few; if a deployment is unusually
	// large, keep serving compressed bytes but stop growing the cache.
	if cache.total+len(data) <= webCompressionCacheBytes {
		cache.items[path] = compressedWebAsset{modTime: info.ModTime(), size: info.Size(), data: data}
		cache.total += len(data)
	}
	return data, nil
}

// serveWebFile serves a static file, gzip-compressed when the client accepts it.
// Callers set Content-Type and Cache-Control first.
func serveWebFile(response http.ResponseWriter, request *http.Request, candidate string, info os.FileInfo) {
	if !webAssetCompressible(candidate, info.Size()) {
		http.ServeFile(response, request, candidate)
		return
	}
	response.Header().Add("Vary", "Accept-Encoding")
	if !acceptsGzip(request.Header.Get("Accept-Encoding")) {
		http.ServeFile(response, request, candidate)
		return
	}
	data, err := webGzipCache.gzipped(candidate, info)
	if err != nil {
		http.ServeFile(response, request, candidate)
		return
	}
	response.Header().Set("Content-Encoding", "gzip")
	http.ServeContent(response, request, filepath.Base(candidate), info.ModTime(), bytes.NewReader(data))
}
