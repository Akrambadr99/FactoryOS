export type OrderPhase = 'material-hold' | 'ready' | 'running' | 'quality-hold' | 'complete'
export interface Execution {
  id: string
  phase: OrderPhase
  materialReleased: boolean
  machineAvailable: boolean
  produced: number
  target: number
  qualityApproved: boolean
  revision: number
  history: readonly string[]
}
export type ExecutionAction =
  | { type: 'release-material' }
  | { type: 'restore-machine' }
  | { type: 'start' }
  | { type: 'produce'; quantity: number }
  | { type: 'approve-quality' }
  | { type: 'complete' }

export const initialExecution: Execution = {
  id: 'PO-8842', phase: 'material-hold', materialReleased: false,
  machineAvailable: false, produced: 0, target: 120, qualityApproved: false,
  revision: 1, history: [],
}

export function executionFinding(order: Execution, action: ExecutionAction): string | null {
  if (order.phase === 'complete') return 'Completed orders cannot be changed.'
  switch (action.type) {
    case 'release-material':
      return order.materialReleased ? 'Material has already been released.' : null
    case 'restore-machine':
      return order.machineAvailable ? 'Machine is already available.' : null
    case 'start':
      if (order.phase !== 'material-hold' && order.phase !== 'ready') return 'Order is not ready to start.'
      if (!order.materialReleased) return 'Lot LOT-55 remains on material hold.'
      if (!order.machineAvailable) return 'Machine M-17 has an active downtime incident.'
      return null
    case 'produce':
      if (order.phase !== 'running') return 'Production must be running.'
      if (!Number.isInteger(action.quantity) || action.quantity <= 0) return 'Quantity must be a positive integer.'
      if (order.produced + action.quantity > order.target) return 'Production would exceed the order target.'
      return null
    case 'approve-quality':
      return order.phase === 'quality-hold' ? null : 'Complete production before quality approval.'
    case 'complete':
      if (order.phase !== 'quality-hold') return 'Production target has not been met.'
      return order.qualityApproved ? null : 'Independent quality approval is required.'
  }
}

export function advanceExecution(order: Execution, action: ExecutionAction): Execution {
  const finding = executionFinding(order, action)
  if (finding) throw new Error(finding)
  const next = { ...order, revision: order.revision + 1, history: [...order.history, action.type] }
  switch (action.type) {
    case 'release-material': return { ...next, materialReleased: true, phase: 'ready' }
    case 'restore-machine': return { ...next, machineAvailable: true }
    case 'start': return { ...next, phase: 'running' }
    case 'produce': {
      const produced = order.produced + action.quantity
      return { ...next, produced, phase: produced === order.target ? 'quality-hold' : 'running' }
    }
    case 'approve-quality': return { ...next, qualityApproved: true }
    case 'complete': return { ...next, phase: 'complete' }
  }
}
