const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const batchController = require('../controllers/batch.controller');
const { authenticate, requirePermission } = require('../middleware/auth');

// 批量删除
router.delete('/:resource',
  authenticate,
  param('resource').isIn(['users', 'tasks', 'scenarios', 'audit-logs']),
  body('ids').isArray({ min: 1 }).withMessage('至少需要一个 ID'),
  requirePermission((req, res) => {
    const resource = req.params.resource;
    return `${resource}:delete`;
  }),
  batchController.batchDelete
);

// 批量更新状态
router.patch('/:resource/status',
  authenticate,
  param('resource').isIn(['users', 'tasks', 'scenarios', 'audit-logs']),
  body('ids').isArray({ min: 1 }).withMessage('至少需要一个 ID'),
  body('status').notEmpty().withMessage('状态不能为空'),
  requirePermission((req, res) => {
    const resource = req.params.resource;
    return `${resource}:update`;
  }),
  batchController.batchUpdateStatus
);

// 批量查询
router.post('/:resource/batch-get',
  authenticate,
  param('resource').isIn(['users', 'tasks', 'scenarios', 'audit-logs']),
  body('ids').isArray({ min: 1 }).withMessage('至少需要一个 ID'),
  body('fields').optional().isArray().withMessage('字段必须是数组'),
  requirePermission((req, res) => {
    const resource = req.params.resource;
    return `${resource}:read`;
  }),
  batchController.batchGet
);

// 批量导出
router.post('/:resource/export',
  authenticate,
  param('resource').isIn(['users', 'tasks', 'scenarios', 'audit-logs']),
  body('ids').isArray({ min: 1 }).withMessage('至少需要一个 ID'),
  body('format').optional().isIn(['csv', 'xlsx']).withMessage('格式必须是 csv 或 xlsx'),
  requirePermission((req, res) => {
    const resource = req.params.resource;
    return `${resource}:read`;
  }),
  batchController.batchExport
);

// 批量分配
router.patch('/:resource/assign',
  authenticate,
  param('resource').isIn(['tasks']),
  body('ids').isArray({ min: 1 }).withMessage('至少需要一个 ID'),
  body('assigneeId').notEmpty().withMessage('分配对象 ID 不能为空'),
  requirePermission('tasks:update'),
  batchController.batchAssign
);

// 验证请求参数
router.use((req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
});

module.exports = router;
