import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import GeminiChatDrawer from '../GeminiChatDrawer.jsx'
import { useInboxStore } from '../../stores/inbox'

describe('GeminiChatDrawer message formatting', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
  })

  it('renders **bold** markers as <strong> without showing asterisks', () => {
    store.chatHistory = [
      { text: 'Update from **City Construction**: plan revised.', sender: 'ai' },
    ]
    const wrapper = mount(GeminiChatDrawer)

    const message = wrapper.find('.chat-msg.ai')
    expect(message.find('strong').text()).toBe('City Construction')
    expect(message.text()).not.toContain('**')
  })

  it('renders newline-separated lines as separate blocks', () => {
    store.chatHistory = [
      {
        text: 'Here is a summary:\n\n1. **First**: one thing.\n2. **Second**: another thing.',
        sender: 'ai',
      },
    ]
    const wrapper = mount(GeminiChatDrawer)

    const lines = wrapper.findAll('.chat-msg.ai .chat-line')
    expect(lines).toHaveLength(3)
    expect(lines[0].text()).toBe('Here is a summary:')
    expect(lines[1].text()).toBe('1. First: one thing.')
    expect(lines[2].text()).toBe('2. Second: another thing.')
  })

  it('renders source chips for AI answers', () => {
    store.chatHistory = [
      {
        text: 'The plan was revised.',
        sender: 'ai',
        sources: [
          { id: 'm1', subject: 'Revised Floor Plan', from_name: 'City Construction' },
          { id: 'm2', subject: 'Claim #99281', from_name: "Homeowner's Insurance" },
        ],
      },
    ]
    const wrapper = mount(GeminiChatDrawer)

    const chips = wrapper.findAll('.chat-source')
    expect(chips).toHaveLength(2)
    expect(chips[0].text()).toContain('Revised Floor Plan')
    expect(chips[0].attributes('title')).toBe('City Construction')
  })

  it('renders plain user messages unchanged', () => {
    store.chatHistory = [{ text: 'Summarize my kitchen renovation updates.', sender: 'user' }]
    const wrapper = mount(GeminiChatDrawer)

    expect(wrapper.find('.chat-msg.user').text()).toBe(
      'Summarize my kitchen renovation updates.',
    )
  })
})
