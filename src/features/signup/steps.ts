/**
 * Signup is seven screens spanning two navigation stacks (the account is
 * created between step 2 and step 3, which is what moves the app from the
 * auth stack to onboarding). The count lives here so the progress bar stays
 * continuous across that handover.
 *
 * The seventh is who you see and who sees you, added because a setting this
 * consequential should be met on the way in rather than found later under
 * three ghost buttons. It sits immediately before the photo step on purpose:
 * "here is who will see this" reads better right before "add a photo" than
 * anywhere else in the flow.
 */
export const SIGNUP_TOTAL_STEPS = 7;
