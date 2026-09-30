import { describe, expectTypeOf, it } from 'vitest'
import type { StoragePort, StorageReader, StorageWriter } from './storage-port'
import type { StoragePort as LegacyStoragePort } from '../workspace/repository'
import type { collectionSignature, compareCollectionSnapshot, createCollectionSnapshot } from '../workspace/collectionSnapshot'
import type { readStored } from '../workspace/storageValidation'

describe('storage capability contracts', () => {
  it('keeps reader and writer capabilities independent and the repository alias compatible', () => {
    expectTypeOf<StoragePort>().toExtend<StorageReader>()
    expectTypeOf<StoragePort>().toExtend<StorageWriter>()
    expectTypeOf<StorageReader>().not.toExtend<StorageWriter>()
    expectTypeOf<StorageWriter>().not.toExtend<StorageReader>()
    expectTypeOf<LegacyStoragePort>().toEqualTypeOf<StoragePort>()
  })
  it('requires only reads for validated reads, exports, comparisons, and signatures', () => {
    expectTypeOf<Parameters<typeof readStored>[0]>().toEqualTypeOf<StorageReader>()
    expectTypeOf<Parameters<typeof createCollectionSnapshot>[1]>().toEqualTypeOf<StorageReader>()
    expectTypeOf<Parameters<typeof compareCollectionSnapshot>[2]>().toEqualTypeOf<StorageReader>()
    expectTypeOf<Parameters<typeof collectionSignature>[1]>().toEqualTypeOf<StorageReader>()
  })
})
