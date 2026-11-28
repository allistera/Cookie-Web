import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantChatPage from '../AssistantChatPage.vue'
import { useInboxStore } from '../../stores/inbox'

let store
let router
let wrapper

function mountPage() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/inbox', component: { template: '<div />' } },
      { path: '/documents/:id?', component: { template: '<div />' } },
    ],
  })
  wrapper = mount(AssistantChatPage, { attachTo: document.body, global: { plugins: [router] } })
  return wrapper
}

async function ask(text, key = {}) {
  const input = wrapper.get('textarea')
  await input.setValue(text)
  await input.trigger('keydown', { key: 'Enter', ...key })
  await flushPromises()
}

describe('AssistantChatPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('starts with a greeting, the question box in focus and nothing to send', () => {
    mountPage()

    expect(wrapper.get('h1').text()).toBe('What can I help with?')
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    expect(wrapper.get('[aria-label="Send message"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.assistant-chat-thread').exists()).toBe(false)
  })

  it('sends on Enter without opening the assistant drawer, and not on Shift+Enter', async () => {
    const asked = vi.spyOn(store, 'askAssistant').mockImplementation(async () => {
      store.isChatDrawerActive = true
      return false
    })
    mountPage()

    await ask('  What is due this week?  ', { shiftKey: true })
    expect(asked).not.toHaveBeenCalled()

    await ask('  What is due this week?  ')
    expect(asked).toHaveBeenCalledExactlyOnceWith('What is due this week?')
    expect(store.isChatDrawerActive).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it('does not send while an answer is still arriving', async () => {
    const asked = vi.spyOn(store, 'askAssistant').mockResolvedValue(false)
    store.chatHistory = [{ text: 'First question', sender: 'user' }]
    store.isChatLoading = true
    mountPage()

    await ask('Second question')

    expect(asked).not.toHaveBeenCalled()
    expect(wrapper.get('.chat-status').text()).toBe('Thinking…')
    expect(wrapper.get('.assistant-chat-new').attributes('disabled')).toBeDefined()
  })

  it('shows the conversation with bold text and sources, and opens a cited document', async () => {
    store.chatHistory = [
      { text: 'What changed?', sender: 'user' },
      {
        text: 'Update from **City Construction**:\nthe plan was revised.',
        sender: 'ai',
        sources: [
          { index: 'messages', id: 'm1', title: 'Revised Floor Plan' },
          { index: 'documents', id: 'd1', title: 'Kitchen plan' },
        ],
      },
    ]
    mountPage()
    const push = vi.spyOn(router, 'push')

    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.get('.assistant-chat-msg.user').text()).toBe('What changed?')
    const reply = wrapper.get('.assistant-chat-msg.ai')
    expect(reply.findAll('.chat-line')).toHaveLength(2)
    expect(reply.get('strong').text()).toBe('City Construction')
    expect(reply.text()).not.toContain('**')
    expect(reply.findAll('.chat-source').map((chip) => chip.element.tagName)).toEqual([
      'SPAN',
      'BUTTON',
    ])

    await reply.get('button.chat-source').trigger('click')
    expect(push).toHaveBeenCalledWith('/documents/d1')
  })

  it('links to the inbox under an answer whose emails the inbox list now shows', async () => {
    vi.spyOn(store, 'askAssistant').mockImplementation(async () => {
      store.chatHistory.push(
        { text: 'Which emails need a reply?', sender: 'user' },
        { text: 'Here are the matching emails:', sender: 'ai', sources: [] },
      )
      return true
    })
    mountPage()

    await ask('Which emails need a reply?')

    const link = wrapper.get('.assistant-chat-msg.ai .assistant-chat-inbox')
    expect(link.text()).toContain('Show these emails in the inbox')
    expect(link.attributes('href')).toBe('/inbox')
    expect(wrapper.find('.assistant-chat-msg.user .assistant-chat-inbox').exists()).toBe(false)
  })

  it('starts a new chat by clearing the conversation and what the model is resent', async () => {
    store.chatHistory = [
      { text: 'What changed?', sender: 'user' },
      { text: 'The plan was revised.', sender: 'ai', sources: [] },
    ]
    store.chatMessages = [
      { role: 'user', content: 'What changed?' },
      { role: 'assistant', content: 'The plan was revised.' },
    ]
    mountPage()

    await wrapper.get('.assistant-chat-new').trigger('click')

    expect(store.chatHistory).toEqual([])
    expect(store.chatMessages).toEqual([])
    expect(wrapper.get('h1').text()).toBe('What can I help with?')
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
  })
})
