import { z } from 'zod'

export const actorSchema = z.object({
  id: z.number().int(),
  gameID: z.number().nullable().optional(),
  name: z.string(),
  type: z.string(),
  subType: z.string().nullable().optional(),
  petOwner: z.number().int().nullable().optional(),
})
export const abilitySchema = z.object({
  gameID: z.number(),
  name: z.string(),
  type: z.number().nullable().optional(),
  icon: z.string().nullable().optional(),
})
export const fightActorSchema = z.object({
  id: z.number().int(),
  gameID: z.number().nullable().optional(),
  instanceCount: z.number().int().nullable().optional(),
  groupCount: z.number().int().nullable().optional(),
  petOwner: z.number().int().nullable().optional(),
})
export const fightSchema = z.object({
  id: z.number().int(),
  encounterID: z.number().int(),
  name: z.string(),
  difficulty: z.number().nullable().optional(),
  startTime: z.number(),
  endTime: z.number(),
  combatTime: z.number().nullable().optional(),
  kill: z.boolean().nullable(),
  bossPercentage: z.number().nullable().optional(),
  fightPercentage: z.number().nullable().optional(),
  friendlyPlayers: z.array(z.number().int()).nullable(),
  enemyPlayers: z.array(z.number().int()).nullish(),
  friendlyNPCs: z.array(fightActorSchema).nullish(),
  friendlyPets: z.array(fightActorSchema).nullish(),
  enemyNPCs: z.array(fightActorSchema).nullish(),
  enemyPets: z.array(fightActorSchema).nullish(),
  gameZone: z.object({ id: z.number().int(), name: z.string() }).nullish(),
})
export const reportSchema = z.object({
  code: z.string(),
  title: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  fights: z.array(fightSchema),
  masterData: z.object({
    lang: z.string().nullable().optional(),
    actors: z.array(actorSchema),
    abilities: z.array(abilitySchema),
  }),
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

export const analysisAbilitySchema = z
  .object({
    guid: z.number(),
    name: z.string(),
    type: z.number().optional(),
    abilityIcon: z.string().optional(),
  })
  .passthrough()
export const analysisEventSchema = z
  .object({
    timestamp: z.number(),
    type: z.string(),
    fight: z.number().nullish(),
    sourceID: z.number().nullish(),
    targetID: z.number().nullish(),
    sourceInstance: z.number().nullish(),
    targetInstance: z.number().nullish(),
    ability: analysisAbilitySchema.nullish(),
  })
  .passthrough()
export const analysisEventPageSchema = z.object({
  data: z.array(analysisEventSchema),
  nextPageTimestamp: z.number().nullable().optional(),
})

export type RawReport = z.infer<typeof reportSchema>
export type RawActor = z.infer<typeof actorSchema>
export type RawEvent = z.infer<typeof eventSchema>
export type RawAnalysisEvent = z.infer<typeof analysisEventSchema>
