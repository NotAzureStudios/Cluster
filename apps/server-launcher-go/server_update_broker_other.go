//go:build !windows

package main

import "errors"

func runUpdateBrokerService(root string) error {
	return errors.New("Cluster Update Broker requires Windows SCM")
}
func installUpdateBroker(root string) error {
	return errors.New("Cluster Update Broker installation requires Windows SCM")
}
func removeUpdateBroker(root string) error {
	return errors.New("Cluster Update Broker removal requires Windows SCM")
}
