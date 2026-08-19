/**
 * Mike Delight's surface, in one import.
 *
 * The dashboard page is a server component; every export here is a client leaf
 * reading the same `OperatorProvider` context. That is what keeps the Actions
 * Required tile and the visible queue reading from ONE derived selector instead
 * of two that agree until they do not.
 */

export { OperatorProvider, useOperator } from '@/components/reactor/operator/OperatorProvider'
export { MikeQueue } from '@/components/reactor/operator/queue/MikeQueue'
export { MikeQueuePanel } from '@/components/reactor/operator/queue/MikeQueuePanel'
export { ActionsRequiredTile } from '@/components/reactor/operator/ActionsRequiredTile'
export { OperatorToast } from '@/components/reactor/operator/OperatorToast'

/** The scroll target for anything that links at the queue. */
export const OPERATOR_QUEUE_ANCHOR = 'mikes-queue'
