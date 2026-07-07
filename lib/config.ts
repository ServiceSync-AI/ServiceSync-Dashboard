/**
 * Runtime config — single source of truth for env-derived settings
 * ================================================================
 * Centralizes every environment variable the dashboard reads so that bucket
 * names, prefixes, and the PC address are defined once. Defaults match the live
 * Chevyland pilot from the build spec; override via .env.local.
 */

export const config = {
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
  },
  audioBucket: process.env.AUDIO_BUCKET ?? 'servicesync-dealership-audio',
  eventsBucket: process.env.EVENTS_BUCKET ?? 'servicesync-advisor-data',
  // Trailing slashes are kept so these can be used directly as S3 prefixes.
  audioPrefix: process.env.AUDIO_PREFIX ?? 'siltaylor/',
  transcriptsPrefix: process.env.TRANSCRIPTS_PREFIX ?? 'transcripts/',
  eventsPrefix: process.env.EVENTS_PREFIX ?? 'raw-events/chevyland_chevrolet/',
  advisorId: process.env.ADVISOR_ID ?? 'siltaylor',
  pc: {
    ip: process.env.DEALER_PC_IP ?? '100.104.185.115',
    user: process.env.SSH_USER ?? 'sil taylor pc',
    keyPath: process.env.SSH_KEY_PATH ?? '~/.ssh/id_ed25519_servicesync_deploy',
  },
} as const;
