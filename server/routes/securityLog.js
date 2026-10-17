// Router HTTP dla logu zdarzen bezpieczenstwa (modules/security/securityLog.js).
// Samo zaimportowanie modulu (ponizej) uruchamia subskrypcje magistrali -
// patrz komentarz na gorze securityLog.js.

import { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import { getHistory, exportCSV, exportJSON, watchedSources } from '../../modules/security/securityLog.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  const { source, level, since, limit } = req.query;
  res.json({
    sources: watchedSources(),
    events: getHistory({ source, level, since: since ? Number(since) : undefined, limit: limit ? Number(limit) : undefined }),
  });
});

router.get('/export', (req, res) => {
  const { source, level, since, format } = req.query;
  const filters = { source, level, since: since ? Number(since) : undefined };
  if (String(format || 'json').toLowerCase() === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="security-log.csv"');
    res.send(exportCSV(filters));
  } else {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="security-log.json"');
    res.send(exportJSON(filters));
  }
});

export default router;
