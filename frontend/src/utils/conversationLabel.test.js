import { conversationPeerName, isPlaceholderName } from './conversationLabel'

describe('conversationLabel', () => {
  it('treats User N as missing for that id only', () => {
    expect(isPlaceholderName('User 735', 735)).toBe(true)
    expect(isPlaceholderName('user_735', 735)).toBe(true)
    expect(isPlaceholderName('User 735', 734)).toBe(false)
    expect(isPlaceholderName('Ena', 735)).toBe(false)
  })

  it('prefers a real participant name over User N', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [
        { user_id: 1, user_name: 'Hritik' },
        { user_id: 735, user_name: 'User 735', user_email: 'ena@shizuha.com' },
      ],
      participant_names: ['User 735'],
    }
    expect(conversationPeerName(conv, 1)).toBe('ena')
  })

  it('uses participant_names when they are real', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [{ user_id: 734, user_name: 'User 734' }],
      participant_names: ['Yuna'],
    }
    expect(conversationPeerName(conv, 1)).toBe('Yuna')
  })
})
