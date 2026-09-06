import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import HomeAgentPicker from '../components/assistant/HomeAgentPicker'

describe('HomeAgentPicker', () => {
  it('stays clickable when nothing is selected, even if locked', async () => {
    const onSearch = vi.fn(async () => [
      { username: 'ena', displayName: 'Ena' },
      { username: 'mio', displayName: 'Mio' },
    ])
    render(createElement(HomeAgentPicker, {
      selectedUsername: '',
      selectedLabel: '',
      options: [],
      locked: true,
      onSearch,
      onSelect: vi.fn(),
    }))
    const chip = screen.getByTestId('home-agent-picker')
    expect(chip.tagName).toBe('BUTTON')
    expect(chip).toHaveTextContent('Choose an agent')
    fireEvent.click(chip)
    expect(await screen.findByPlaceholderText('Search agents…')).toBeInTheDocument()
  })

  it('locks a customer who already has a personal Shizuha', () => {
    render(createElement(HomeAgentPicker, {
      selectedUsername: 'shizuha-279',
      selectedLabel: 'Shizuha',
      options: [{ username: 'shizuha-279', displayName: 'Shizuha' }],
      locked: true,
      onSearch: vi.fn(),
      onSelect: vi.fn(),
    }))
    const chip = screen.getByTestId('home-agent-picker')
    expect(chip.tagName).toBe('DIV')
    expect(chip).toHaveTextContent('Talking to Shizuha')
  })
})
