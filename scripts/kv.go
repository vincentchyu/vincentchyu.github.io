package scripts

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/cloudflare/cloudflare-go/v6"
	"github.com/cloudflare/cloudflare-go/v6/kv"
)

var (
	kVConfig *KVConfig
)

type KVConfig struct {
	CFConfig
	DatabaseId string
}

func BuildKVConfig() *KVConfig {
	config := &KVConfig{
		CFConfig: CFConfig{
			AccountId: getEnv("CF_ACCOUNT_ID"),
			ApiToken:  getEnv("CF_API_TOKEN"),
		},
		DatabaseId: getEnv("CF_KV_DATABASE_ID"),
	}

	return config
}

func init() {
	var one sync.Once
	one.Do(
		func() {
			kVConfig = BuildKVConfig()
			CFCli = NewCFClient(BuildConfig())
		},
	)
}

func CfKvGetValue(keyName string) (value string, err error) {
	config := kVConfig
	// read
	resp, err := CFCli.KV.Namespaces.Values.Get(
		context.TODO(),
		config.DatabaseId,
		keyName,
		kv.NamespaceValueGetParams{
			AccountID: cloudflare.F(config.AccountId),
		},
	)
	if err != nil {
		var apierr *cloudflare.Error
		if errors.As(err, &apierr) {
			return "", apierr
		}
		return "", err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		var apierr *cloudflare.Error
		if errors.As(err, &apierr) {
			return "", apierr
		}
		return "", err
	}
	/*if !bytes.Equal(b, []byte("Some Value")) {
		t.Fatalf("return value not %s: %s", "abc", b)
	}*/
	return string(b), nil
}

func CfKvSetValue(keyName, value string, expirationTtl float64) error {
	config := kVConfig
	// write
	_, err := CFCli.KV.Namespaces.Values.Update(
		context.TODO(),
		config.DatabaseId,
		keyName,
		kv.NamespaceValueUpdateParams{
			AccountID:     cloudflare.F(config.AccountId),
			Value:         cloudflare.F(value),
			ExpirationTTL: cloudflare.F(expirationTtl),
			Metadata:      cloudflare.F[any](map[string]interface{}{}),
		},
	)
	if err != nil {
		var upper *cloudflare.Error
		if errors.As(err, &upper) {
			return upper
		}
	}
	return err
}
