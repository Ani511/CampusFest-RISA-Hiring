import { handleModels, type ApiRequest, type ApiResponse } from '../../server/chatRoutes.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ models: [], defaultModel: null, error: 'Method not allowed.' });
    return;
  }
  await handleModels(req, res);
}
