import { z } from 'zod'

export const actorSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  subType: z.string().nullable().optional(),
  petOwner: z.number().int().nullable().optional(),
})
export const abilitySchema = z.object({ gameID: z.number(), name: z.string() })
export const fightSchema = z.object({
  id: z.number().int(),
  encounterID: z.number().int(),
  name: z.string(),
  difficulty: z.number().nullable().optional(),
  startTime: z.number(),
  endTime: z.number(),
  kill: z.boolean().nullable(),
  bossPercentage: z.number().nullable().optional(),
  fightPercentage: z.number().nullable().optional(),
  friendlyPlayers: z.array(z.number().int()).nullable(),
})
export const reportSchema = z.object({
  code: z.string(),
  title: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  fights: z.array(fightSchema),
  masterData: z.object({ actors: z.array(actorSchema), abilities: z.array(abilitySchema) }),
})
export const eventSchema = z
  .object({
    timestamp: z.number(),
    type: z.string(),
    sourceID: z.number().nullish(),
    targetID: z.number().nullish(),
    abilityGameID: z.number().nullish(),
    killingAbilityGameID: z.number().nullish(),
    amount: z.number().nullish(),
    overkill: z.number().nullish(),
    fight: z.number().nullish(),
    targetResources: z.object({ hitPoints: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough()
export const eventPageSchema = z.object({
  data: z.array(eventSchema),
  nextPageTimestamp: z.number().nullable().optional(),
})
export type RawReport = z.infer<typeof reportSchema>
export type RawActor = z.infer<typeof actorSchema>
export type RawEvent = z.infer<typeof eventSchema>
