import type { LLMProvider, ProviderOptions } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { GoogleProvider } from './google'
import { MockProvider } from './mock'

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google', 'mock'] as const
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number]

export function isSupportedProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name)
}

/** Construct a provider by name. Throws on unknown providers. */
export function createProvider(name: string, opts: ProviderOptions): LLMProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(opts)
    case 'openai':
      return new OpenAIProvider(opts)
    case 'google':
      return new GoogleProvider(opts)
    case 'mock':
      return new MockProvider()
    default:
      throw new Error(`Unsupported provider: ${name}`)
  }
}
