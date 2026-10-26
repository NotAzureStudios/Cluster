package main

import (
	"encoding/binary"
	"testing"
)

func TestDecodeListenerOwnersIPv4(t *testing.T) {
	buf := make([]byte, 4+24)
	binary.LittleEndian.PutUint32(buf[:4], 1)
	copy(buf[8:12], []byte{127, 0, 0, 1})
	binary.BigEndian.PutUint16(buf[12:14], 54321)
	binary.LittleEndian.PutUint32(buf[24:28], 808)
	result := parseTCPListenerOwners(buf, false)
	if len(result) != 1 || result[0].Port != 54321 || result[0].PID != 808 || result[0].Address != "127.0.0.1" {
		t.Fatalf("unexpected IPv4 listeners: %+v", result)
	}
}
func TestDecodeListenerOwnersIPv6(t *testing.T) {
	buf := make([]byte, 4+56)
	binary.LittleEndian.PutUint32(buf[:4], 1)
	buf[4+15] = 1
	binary.BigEndian.PutUint16(buf[4+20:4+22], 3000)
	binary.LittleEndian.PutUint32(buf[4+52:4+56], 92)
	result := parseTCPListenerOwners(buf, true)
	if len(result) != 1 || result[0].Port != 3000 || result[0].PID != 92 || result[0].Address != "::1" {
		t.Fatalf("unexpected IPv6 listeners: %+v", result)
	}
}
func TestRejectTruncatedTCPTable(t *testing.T) {
	for _, ipv6 := range []bool{true, false} {
		buf := make([]byte, 12)
		binary.LittleEndian.PutUint32(buf[:4], 20)
		if parsed := parseTCPListenerOwners(buf, ipv6); len(parsed) != 0 {
			t.Fatal("accepted truncated kernel table")
		}
	}
}
