import {
  conversationPeer,
  conversationPeerName,
  isPlaceholderName,
  isSelfDirectConversation,
  sameUserId,
} from './conversationLabel'

describe('conversationLabel', () => {
  it('treats User N as missing for that id only', () => {
    expect(isPlaceholderName('User 735', 735)).toBe(true)
    expect(isPlaceholderName('user_735', 735)).toBe(true)
    expect(isPlaceholderName('User 735', 734)).toBe(false)
    expect(isPlaceholderName('Ena', 735)).toBe(false)
  })

  it('compares user ids as strings', () => {
    expect(sameUserId(3, '3')).toBe(true)
    expect(sameUserId('3', 3)).toBe(true)
    expect(sameUserId(3, 3)).toBe(true)
    expect(sameUserId(3, 4)).toBe(false)
    expect(sameUserId(3, null)).toBe(false)
    expect(sameUserId('', 3)).toBe(false)
  })

  it('prefers a real participant name over User N', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [
        { user_id: 1, user_name: 'Hritik Soni' },
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

  it('does not label a DM as the current user when they are listed first', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [
        { user_id: 3, user_name: 'Hritik Soni' },
        { user_id: 17, user_name: 'Aoi' },
      ],
      participant_names: ['Aoi'],
    }
    expect(conversationPeerName(conv, 3)).toBe('Aoi')
    expect(conversationPeerName(conv, '3')).toBe('Aoi')
  })

  it('does not pick the first participant as the peer when currentUserId is missing', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [
        { user_id: 3, user_name: 'Hritik Soni' },
        { user_id: 17, user_name: 'Aoi' },
      ],
      participant_names: ['Aoi'],
    }
    expect(conversationPeerName(conv, undefined)).toBe('Aoi')
    expect(conversationPeer(conv, undefined)).toBe(null)
  })

  it('skips the current user name in participant_names fallback', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [
        { user_id: 3, user_name: 'Hritik Soni' },
        { user_id: 88, user_name: 'User 88', user_email: 'nagi@agents.shizuha.io' },
      ],
      participant_names: ['Hritik Soni', 'Nagi'],
    }
    expect(conversationPeerName(conv, 3)).toBe('Nagi')
  })

  it('detects a self-only direct conversation', () => {
    const conv = {
      conversation_type: 'direct',
      participants: [{ user_id: 3, user_name: 'Hritik Soni' }],
      participant_names: ['Hritik Soni'],
    }
    expect(isSelfDirectConversation(conv, 3)).toBe(true)
    expect(isSelfDirectConversation(conv, '3')).toBe(true)
    expect(isSelfDirectConversation(conv, 17)).toBe(false)
  })
})
