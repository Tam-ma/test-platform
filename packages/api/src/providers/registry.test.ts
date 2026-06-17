import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProvider, isSupportedProvider, SUPPORTED_PROVIDERS } from './registry'
import { MockProvider } from './mock'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

afterEach(() => vi.unstubAllGlobals())

describe('registry', () => {
  it('creates each supported provider with the right name', () => {
    for (const name of SUPPORTED_PROVIDERS) {
      expect(createProvider(name, { apiKey: 'k' }).name).toBe(name)
    }
  })

  it('throws on unknown providers', () => {
    expect(() => createProvider('nope', { apiKey: 'k' })).toThrow(/Unsupported provider/)
  })

  it('narrows with isSupportedProvider', () => {
    expect(isSupportedProvider('openai')).toBe(true)
    expect(isSupportedProvider('nope')).toBe(false)
  })

  it('requires an api key for real providers', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(/required/)
  })
})

describe('MockProvider', () => {
  it('echoes the prompt and reports consistent usage', async () => {
    const res = await new MockProvider().complete({ model: 'm', prompt: 'hello world' })
    expect(res.content).toContain('hello world')
    expect(res.usage.totalTokens).toBe(res.usage.promptTokens + res.usage.completionTokens)
    expect(res.model).toBe('m')
  })

  it('returns a fixed response when configured', async () => {
    const res = await new MockProvider({ response: 'canned' }).complete({ model: 'm', prompt: 'x' })
    expect(res.content).toBe('canned')
  })
})

describe('AnthropicProvider.complete', () => {
  it('posts to the messages API and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'claude-x',
        content: [{ text: 'hi there' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await new AnthropicProvider({ apiKey: 'sk-ant' }).complete({
      model: 'claude-x',
      prompt: 'hi',
      systemPrompt: 'be brief',
      maxTokens: 100,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-x')
    expect(body.system).toBe('be brief')
    expect(body.messages[0].content).toBe('hi')

    expect(res.content).toBe('hi there')
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    expect(res.finishReason).toBe('end_turn')
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
    await expect(
      new AnthropicProvider({ apiKey: 'k' }).complete({ model: 'm', prompt: 'x' }),
    ).rejects.toThrow(/401/)
  })
})

describe('OpenAIProvider.complete', () => {
  it('posts to chat/completions and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-x',
        choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await new OpenAIProvider({ apiKey: 'sk-oa' }).complete({ model: 'gpt-x', prompt: 'ping' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-oa')
    expect(res.content).toBe('pong')
    expect(res.usage.totalTokens).toBe(4)
  })
})
