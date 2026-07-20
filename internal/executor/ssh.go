package executor

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type HostConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
}

type SSHClient struct {
	Host   string
	Client *ssh.Client
	SFTP   *sftp.Client
}

func normalizeHostConfig(cfg HostConfig) HostConfig {
	if cfg.Port <= 0 {
		cfg.Port = 22
	}
	if cfg.User == "" {
		cfg.User = "root"
	}
	return cfg
}

func getSSHAuthMethods(cfg HostConfig) ([]ssh.AuthMethod, error) {
	if cfg.Password != "" {
		return []ssh.AuthMethod{ssh.Password(cfg.Password)}, nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("could not find home dir: %v", err)
	}

	keyPath := filepath.Join(homeDir, ".ssh", "id_rsa")
	key, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read private key: %v", err)
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("unable to parse private key: %v", err)
	}

	return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
}

func NewSSHClient(hostCfg HostConfig) (*SSHClient, error) {
	cfg := normalizeHostConfig(hostCfg)
	authMethods, err := getSSHAuthMethods(cfg)
	if err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // Equivalent to StrictHostKeyChecking=no
		Timeout:         5 * time.Second,
	}

	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, fmt.Errorf("failed to dial: %v", err)
	}

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create sftp client: %v", err)
	}

	return &SSHClient{
		Host:   address,
		Client: client,
		SFTP:   sftpClient,
	}, nil
}

func (s *SSHClient) Close() {
	if s.SFTP != nil {
		s.SFTP.Close()
	}
	if s.Client != nil {
		s.Client.Close()
	}
}

func (s *SSHClient) RunCommand(cmd string) (string, error) {
	session, err := s.Client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %v", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

func (s *SSHClient) RunCommandNoWait(cmd string) error {
	session, err := s.Client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %v", err)
	}

	if err := session.Start(cmd); err != nil {
		session.Close()
		return err
	}
	return nil
}
