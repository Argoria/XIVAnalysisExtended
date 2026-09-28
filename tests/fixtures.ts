import type { RawEvent, RawReport } from '../server/fflogs/schema'

export const fixture: RawReport = {
  code: 'nvM2FT6QLkJ4Bb19',
  title: 'Fixture only',
  startTime: 1700000000000,
  endTime: 1700000500000,
  masterData: {
    actors: [
      { id: 1, name: 'Tank', type: 'Player', subType: 'Gunbreaker' },
      { id: 2, name: 'Healer', type: 'Player', subType: 'Astrologian' },
      { id: 3, name: 'Substitute', type: 'Player', subType: 'Scholar' },
      { id: 4, name: 'Unrelated player', type: 'Player', subType: 'Warrior' },
      { id: 10, name: 'Limit Break', type: 'Player', subType: 'LimitBreak' },
      { id: 11, name: 'Limit Break', type: 'NPC', subType: null },
      { id: 12, name: 'Fairy', type: 'Pet', subType: null, petOwner: 1 },
      { id: 20, name: 'Boss', type: 'NPC', subType: 'Boss' },
    ],
    abilities: [
      { gameID: 100, name: 'Raidwide' },
      { gameID: 101, name: 'Attack' },
      { gameID: 200, name: 'Limit Break ability' },
    ],
  },
  fights: [
    {
      id: 99,
      encounterID: 0,
      name: 'Area trash',
      startTime: 0,
      endTime: 50000,
      kill: false,
      friendlyPlayers: [4],
    },
    {
      id: 1,
      encounterID: 96,
      name: 'Boss',
      difficulty: 101,
      startTime: 60000,
      endTime: 160000,
      kill: false,
      bossPercentage: 40,
      fightPercentage: 65,
      friendlyPlayers: [1, 2, 10, 11, 12],
    },
    {
      id: 2,
      encounterID: 96,
      name: 'Boss',
      difficulty: 101,
      startTime: 200000,
      endTime: 400000,
      kill: true,
      bossPercentage: null,
      fightPercentage: null,
      friendlyPlayers: [1, 3],
    },
  ],
}
export const event = (type: string, timestamp: number, fields: Partial<RawEvent> = {}): RawEvent => ({
  type,
  timestamp,
  ...fields,
})
