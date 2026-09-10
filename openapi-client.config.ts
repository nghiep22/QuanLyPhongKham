import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'be/contracts/openapi/openapi.yaml',
  output: {
    path: 'packages/generated-api-client/src/generated',
    clean: true,
  },
});
