import { getRandomBytes } from 'expo-crypto';
import { uuidv7 } from '@repo/api-contract';

/** Client-generated UUID v7 for transactional creates. RN has no `crypto.getRandomValues`. */
export const newId = () => uuidv7(getRandomBytes(10));
