import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SideChatAsk, SideChatContext, SideChatReply } from '@/store/side-chat'

import { SideChatApp } from './side-chat-app'

// The shell the window talks to. Both `onContext` and `onReply` capture their
// subscriber so a test can push the IPC traffic main would send.
function stubShell(pulled: null | SideChatContext = null) {
  const ask = vi.fn<(payload: SideChatAsk) => void>()
  const close = vi.fn()
  const getContext = vi.fn(async () => pulled)

  const listeners: {
    context?: (context: SideChatContext) => void
    reply?: (reply: SideChatReply) => void
  } = {}

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      sideChat: {
        ask,
        close,
        getContext,
        onContext: (callback: (context: SideChatContext) => void) => {
          listeners.context = callback

          return () => undefined
        },
        onReply: (callback: (reply: SideChatReply) => void) => {
          listeners.reply = callback

          return () => undefined
        },
        open: vi.fn(),
        reply: vi.fn()
      }
    }
  })

  return {
    ask,
    close,
    getContext,
    pushContext: (context: Partial<SideChatContext> & { sessionId: string }) =>
      act(() => listeners.context?.({ question: '', title: '', ...context })),
    pushReply: (reply: SideChatReply) => act(() => listeners.reply?.(reply))
  }
}

let shell: ReturnType<typeof stubShell>

const composer = () => screen.getByLabelText('Ask a side question')

describe('SideChatApp', () => {
  beforeEach(() => {
    shell = stubShell()
    render(<SideChatApp />)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  it('waits for the conversation before it will take a question', () => {
    // prompt.btw snapshots ONE conversation; until main says which, a typed
    // question could never be answered.
    expect((composer() as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByText(/Connecting/)).toBeTruthy()
  })

  it('asks the seed question from `/btw <question>` without the user typing', () => {
    shell.pushContext({ question: 'which file was that error in?', sessionId: 's1', title: 'Fix the build' })

    expect(shell.ask).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', text: 'which file was that error in?' })
    )
    expect(screen.getByText('which file was that error in?')).toBeTruthy()
    expect(screen.getByText('Thinking…')).toBeTruthy()
    // The window is named after the chat it is an aside to.
    expect(screen.getByText(/Fix the build/)).toBeTruthy()
  })

  it('renders the answer when it comes back', () => {
    shell.pushContext({ question: 'which file?', sessionId: 's1' })
    const askId = shell.ask.mock.calls[0][0].askId

    shell.pushReply({ askId, error: '', text: 'src/main.ts' })

    expect(screen.getByText('src/main.ts')).toBeTruthy()
    expect(screen.queryByText('Thinking…')).toBeNull()
  })

  it('surfaces a failure instead of leaving the question thinking', () => {
    shell.pushContext({ question: 'which file?', sessionId: 's1' })
    const askId = shell.ask.mock.calls[0][0].askId

    shell.pushReply({ askId, error: 'This backend is too old for side questions.', text: '' })

    expect(screen.getByText('This backend is too old for side questions.')).toBeTruthy()
    expect(screen.queryByText('Thinking…')).toBeNull()
  })

  it('sends a typed follow-up on Enter and clears the composer', () => {
    shell.pushContext({ sessionId: 's1' })

    fireEvent.change(composer(), { target: { value: 'and the stack trace?' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(shell.ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', text: 'and the stack trace?' }))
    expect((composer() as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps a half-typed follow-up when Shift+Enter adds a newline', () => {
    shell.pushContext({ sessionId: 's1' })

    fireEvent.change(composer(), { target: { value: 'first line' } })
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true })

    expect(shell.ask).not.toHaveBeenCalled()
    expect((composer() as HTMLTextAreaElement).value).toBe('first line')
  })

  it('closes itself through the shell', () => {
    fireEvent.click(screen.getByLabelText('Close side chat'))

    expect(shell.close).toHaveBeenCalled()
  })
})

describe('SideChatApp context delivery', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  // Regression: main used to PUSH the context on `did-finish-load`. This window
  // mounts through a dynamic import, so that fired before the subscription
  // existed and the push was lost — the window sat on "Connecting…" with a dead
  // composer and the `/btw` question was never asked. Caught by the e2e, not by
  // the unit tests, because only a real window has the import delay.
  it('pulls the conversation on mount rather than waiting for a push', async () => {
    const seeded = stubShell({ question: 'which file?', sessionId: 's1', title: 'Fix the build' })

    render(<SideChatApp />)

    expect(seeded.getContext).toHaveBeenCalled()
    await screen.findByText('which file?')
    expect(seeded.ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', text: 'which file?' }))
    expect((screen.getByLabelText('Ask a side question') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('stays usable when there is nothing to pull yet', async () => {
    const empty = stubShell(null)

    render(<SideChatApp />)

    await act(async () => undefined)
    expect(empty.ask).not.toHaveBeenCalled()
    // A later push still arrives — that is what a second `/btw` sends.
    empty.pushContext({ question: 'late question', sessionId: 's2' })
    expect(empty.ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's2', text: 'late question' }))
  })
})
