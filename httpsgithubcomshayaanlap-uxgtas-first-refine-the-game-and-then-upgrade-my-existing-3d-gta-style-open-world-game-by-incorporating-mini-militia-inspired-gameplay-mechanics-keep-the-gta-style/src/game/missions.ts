// Data-driven mission definitions. Add more entries here to extend the game.
// Anchors: 'door:<id>', 'stall:<kind>', 'pos:x,z[,y]', 'flyover'
export type StepType = 'door' | 'buy' | 'sit' | 'collect' | 'vehicle' | 'goto' | 'route'
export interface MStep {
  text: string
  type: StepType
  target?: string
  r?: number
  count?: number
  time?: number // seconds, optional timer for this step
  needVehicle?: boolean
  minY?: number
  route?: string[]
  vkind?: string
}
export interface Mission {
  id: string
  title: string
  desc: string
  reward: number
  steps: MStep[]
}

export const MISSIONS: Mission[] = [
  {
    id: 'welcome',
    title: 'Welcome to Nellyadi',
    desc: 'Get your bearings in the town centre.',
    reward: 300,
    steps: [
      { text: 'Walk to Nellyadi Stores and go inside', type: 'door', target: 'door:store' },
      { text: 'Buy something at the counter', type: 'buy' },
      { text: 'Sit on the bench at the bus stop', type: 'sit', target: 'pos:-76,-8.4' },
      { text: 'Pick up 3 golden areca nuts', type: 'collect', count: 3 },
    ],
  },
  {
    id: 'wheels',
    title: 'Wheels',
    desc: 'Scooters, autos, cars and buses are all drivable.',
    reward: 500,
    steps: [
      { text: 'Get on any vehicle (press E next to it)', type: 'vehicle' },
      { text: 'Drive to the Bypass flyover', type: 'goto', target: 'pos:300,-200', r: 14, needVehicle: true },
      { text: 'Reach the top of the flyover', type: 'goto', target: 'flyover', r: 10, minY: 6 },
    ],
  },
  {
    id: 'chai',
    title: 'Chai run',
    desc: 'Take fresh tea from the stall to the hotel before it goes cold.',
    reward: 400,
    steps: [
      { text: 'Collect the tea flask at the tea stall', type: 'goto', target: 'stall:tea', r: 3.2 },
      { text: 'Deliver it to Udupi Hotel (3 minutes)', type: 'door', target: 'door:hotel', time: 180 },
    ],
  },
  {
    id: 'timetrial',
    title: 'Main Road time trial',
    desc: 'Drive through all checkpoints on the main road in time.',
    reward: 800,
    steps: [
      { text: 'Get in a vehicle and reach the start line', type: 'goto', target: 'pos:-150,-2.3', r: 8, needVehicle: true },
      {
        text: 'Drive through the checkpoints (75 s)', type: 'route', time: 75,
        route: ['pos:-60,-2.3', 'pos:30,-2.3', 'pos:140,-2.3', 'pos:230,-2.3', 'pos:300,-2.3'],
      },
    ],
  },
  {
    id: 'collector',
    title: 'Areca collector',
    desc: 'Golden areca nuts are hidden around town, plantations, hills and flyover.',
    reward: 1000,
    steps: [{ text: 'Collect 12 more golden areca nuts', type: 'collect', count: 12 }],
  },
]
