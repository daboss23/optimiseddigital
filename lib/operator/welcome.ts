/**
 * The welcome — what Mike says the first time a new operator meets him.
 *
 * Fixed copy, written by the founder, delivered word for word. It is NOT
 * model-generated: a greeting does not need a model call, it needs to be
 * instant, exact, and identical on every deployment. The only variable is the
 * operator's name, which the deployment supplies (NEXT_PUBLIC_OPERATOR_NAME
 * now, the brand-settings profile when that lands).
 *
 * Shown once per browser per deployment — `welcomedAt` in the operator memory
 * is what "fresh for every new customer" means in practice: a new customer is
 * a new browser on a new domain, so their first login gets the first meeting.
 */

export const MIKE_WELCOME_TEMPLATE = `Hey {name}! Welcome to the Creative Reactor, they call me Mike Delight, but you can just call me 'Smooth Operator'.

Why you may ask? Because apparently I'm kind of a big deal when it comes to Meta ads! I'm your daily wingman helping you optimise and analyse all of your creative and Meta data, so you can turn this Creative Reactor into a well-oiled machine!`

/** The greeting with the operator's name in it. No name on record → "there". */
export function welcomeCopy(name: string | null): string {
  return MIKE_WELCOME_TEMPLATE.replace('{name}', name?.trim() || 'there')
}
