// Next.js 16 route handler for NextAuth. The `handlers` export from NextAuth
// is an object `{ GET, POST }`. We destructure and re-export each method
// individually so Next.js's route-handler type-checking sees the correct
// `(request, context) => Response` signature.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
