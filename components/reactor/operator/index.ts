/**
 * Mike Delight's surface, in one import.
 *
 * The dashboard page is a server component; every export here is a client leaf
 * that reads the same `OperatorProvider` context. That is what keeps the header
 * count, the Actions Required tile and the visible queue reading from ONE
 * derived selector instead of three that agree until they do not.
 */

export { OperatorProvider, useOperator } from '@/components/reactor/operator/OperatorProvider'
export { MikeHeader, OPERATOR_QUEUE_ANCHOR } from '@/components/reactor/operator/MikeHeader'
export { ProposalQueue, QueueCountPill } from '@/components/reactor/operator/ProposalQueue'
export { ActionsRequiredTile } from '@/components/reactor/operator/ActionsRequiredTile'
export { OperatorToast } from '@/components/reactor/operator/OperatorToast'
export { DebugPanel } from '@/components/reactor/operator/DebugPanel'
