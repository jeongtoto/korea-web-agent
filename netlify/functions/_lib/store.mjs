import { getStore } from '@netlify/blobs';

export function getKoreaWebAgentStore() {
  const blobs = getStore({ name: 'korea-web-agent-v1', consistency: 'strong' });
  return {
    async getJSON(key) {
      return blobs.get(key, { type: 'json', consistency: 'strong' });
    },
    async setJSON(key, value) {
      await blobs.setJSON(key, value);
    },
    async delete(key) {
      await blobs.delete(key);
    },
  };
}
