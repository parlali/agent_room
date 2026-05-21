export const onboardingRequiredToStartSessionMessage =
    'Complete the room intro before starting a new session'

export const onboardingRequiredToContinueSessionMessage =
    'Complete the room intro before continuing regular sessions'

export const onboardingDeferredStatus = 'onboarding_deferred'

export function isOnboardingRequiredMessage(message: string): boolean {
    return (
        message === onboardingRequiredToStartSessionMessage ||
        message === onboardingRequiredToContinueSessionMessage
    )
}

export function isRoomOnboardingSkipMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ')
    return normalized === 'skip' || normalized === '/skip' || normalized === 'skip onboarding'
}
