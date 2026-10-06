/** Google Play target-API requirement. Verified 2026-10-03 from https://developer.android.com/google/play/requirements/target-sdk */
export const PLAY_REQUIRED_TARGET_SDK = 36;
export const PLAY_REQUIREMENT_VERIFIED_ON = '2026-10-03';
export const playCompliance = (targetSdk: number): 'YES' | 'NO' => (targetSdk >= PLAY_REQUIRED_TARGET_SDK ? 'YES' : 'NO');
