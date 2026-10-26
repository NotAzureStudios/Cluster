package main

import (
	"encoding/binary"
	"net"
)

// Read-only Windows GetExtendedTcpTable row decoding. Native inspection does
// not bind sockets, execute netstat/PowerShell or require administrator rights.
type tcpListenerOwner struct {
	Port    int
	PID     uint32
	Address string
}

func parseTCPListenerOwners(buffer []byte, ipv6 bool) []tcpListenerOwner {
	if len(buffer) < 4 {
		return nil
	}
	count := int(binary.LittleEndian.Uint32(buffer[:4]))
	size := 24
	if ipv6 {
		size = 56
	}
	if count > (len(buffer)-4)/size {
		return nil
	}
	owners := make([]tcpListenerOwner, 0, count)
	for i := 0; i < count; i++ {
		row := buffer[4+i*size : 4+(i+1)*size]
		var port int
		var pid uint32
		var address string
		if ipv6 {
			port = int(binary.BigEndian.Uint16(row[20:22]))
			pid = binary.LittleEndian.Uint32(row[52:56])
			address = net.IP(row[0:16]).String()
		} else {
			port = int(binary.BigEndian.Uint16(row[8:10]))
			pid = binary.LittleEndian.Uint32(row[20:24])
			address = net.IP(row[4:8]).String()
		}
		if port > 0 {
			owners = append(owners, tcpListenerOwner{Port: port, PID: pid, Address: address})
		}
	}
	return owners
}
