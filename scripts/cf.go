package scripts

import (
	"github.com/cloudflare/cloudflare-go/v6"
	"github.com/cloudflare/cloudflare-go/v6/option"
)

var (
	CFCli *CFClient
)

type CFConfig struct {
	AccountId string
	ApiToken  string
}

type CFClient struct {
	*cloudflare.Client
	config *CFConfig
}

func BuildConfig() *CFConfig {
	config := &CFConfig{
		AccountId: getEnv("CF_ACCOUNT_ID"),
		ApiToken:  getEnv("CF_API_TOKEN"),
	}
	return config
}

func NewCFClient(config *CFConfig) *CFClient {
	client := cloudflare.NewClient(
		// option.WithBaseURL("baseURL"),
		// option.WithAPIKey("144c9defac04969c7bfad8efaa8ea194"),
		// option.WithAPIEmail("user@example.com"),
		// option.WithAPIToken("Ds42XPJIsBgXtiVIHA2BjC4x7YMlIxcUbhRNv3Sr"),
		option.WithAPIToken(config.ApiToken),
	)
	cfClient := &CFClient{
		Client: client,
		config: config,
	}
	return cfClient
}
