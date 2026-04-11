const { query } = require('../utils/database');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// 批量删除
async function batchDelete(req, res) {
  try {
    const { resource } = req.params;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: '无效的请求参数'
      });
    }

    const idPlaceholders = ids.map(() => '?').join(',');
    let tableName;
    
    switch (resource) {
      case 'users': tableName = 'users'; break;
      case 'tasks': tableName = 'tasks'; break;
      case 'scenarios': tableName = 'scenarios'; break;
      case 'audit-logs': tableName = 'audit_logs'; break;
      default:
        return res.status(400).json({ success: false, error: '无效的资源类型' });
    }

    const sql = `DELETE FROM ${tableName} WHERE id IN (${idPlaceholders})`;
    const result = await query(sql, ids);

    logger.info(`批量删除 ${resource}: 删除了 ${result.affectedRows} 条记录`);

    res.json({
      success: true,
      deleted_count: result.affectedRows,
      failed_ids: []
    });
  } catch (error) {
    logger.error('批量删除失败:', error.message);
    res.status(500).json({
      success: false,
      error: '批量删除失败'
    });
  }
}

// 批量更新状态
async function batchUpdateStatus(req, res) {
  try {
    const { resource } = req.params;
    const { ids, status } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '无效的请求参数' });
    }

    const idPlaceholders = ids.map(() => '?').join(',');
    let tableName;
    
    switch (resource) {
      case 'users': tableName = 'users'; break;
      case 'tasks': tableName = 'tasks'; break;
      case 'scenarios': tableName = 'scenarios'; break;
      case 'audit-logs': tableName = 'audit_logs'; break;
      default:
        return res.status(400).json({ success: false, error: '无效的资源类型' });
    }

    const sql = `UPDATE ${tableName} SET status = ? WHERE id IN (${idPlaceholders})`;
    const result = await query(sql, [status, ...ids]);

    logger.info(`批量更新状态 ${resource}: 更新了 ${result.affectedRows} 条记录`);

    res.json({
      success: true,
      updated_count: result.affectedRows,
      failed_ids: []
    });
  } catch (error) {
    logger.error('批量更新状态失败:', error.message);
    res.status(500).json({
      success: false,
      error: '批量更新状态失败'
    });
  }
}

// 批量导出
async function batchExport(req, res) {
  try {
    const { resource } = req.params;
    const { ids, format = 'csv', fields } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '无效的请求参数' });
    }

    const idPlaceholders = ids.map(() => '?').join(',');
    let tableName;
    
    switch (resource) {
      case 'users': tableName = 'users'; break;
      case 'tasks': tableName = 'tasks'; break;
      case 'scenarios': tableName = 'scenarios'; break;
      case 'audit-logs': tableName = 'audit_logs'; break;
      default:
        return res.status(400).json({ success: false, error: '无效的资源类型' });
    }

    const selectFields = fields && fields.length > 0 ? fields.join(', ') : '*';
    const sql = `SELECT ${selectFields} FROM ${tableName} WHERE id IN (${idPlaceholders})`;
    const data = await query(sql, ids);

    // 生成 CSV
    if (format === 'csv') {
      const headers = data.length > 0 ? Object.keys(data[0]) : [];
      const csvRows = [headers.join(',')];
      data.forEach(row => {
        csvRows.push(headers.map(header => row[header] || '').join(','));
      });
      const csv = csvRows.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${resource}_export.csv`);
      return res.send(csv);
    }

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    logger.error('批量导出失败:', error.message);
    res.status(500).json({
      success: false,
      error: '批量导出失败'
    });
  }
}

// 批量分配
async function batchAssign(req, res) {
  try {
    const { resource } = req.params;
    const { ids, assigneeId } = req.body;

    if (resource !== 'tasks') {
      return res.status(400).json({ success: false, error: '仅支持任务分配' });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '无效的请求参数' });
    }

    const idPlaceholders = ids.map(() => '?').join(',');
    const sql = `UPDATE tasks SET assignee_id = ? WHERE id IN (${idPlaceholders})`;
    const result = await query(sql, [assigneeId, ...ids]);

    logger.info(`批量分配任务：分配了 ${result.affectedRows} 个任务给用户 ${assigneeId}`);

    res.json({
      success: true,
      assigned_count: result.affectedRows,
      failed_ids: []
    });
  } catch (error) {
    logger.error('批量分配失败:', error.message);
    res.status(500).json({
      success: false,
      error: '批量分配失败'
    });
  }
}

// 批量查询
async function batchGet(req, res) {
  try {
    const { resource } = req.params;
    const { ids, fields } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '无效的请求参数' });
    }

    const idPlaceholders = ids.map(() => '?').join(',');
    let tableName;
    
    switch (resource) {
      case 'users': tableName = 'users'; break;
      case 'tasks': tableName = 'tasks'; break;
      case 'scenarios': tableName = 'scenarios'; break;
      case 'audit-logs': tableName = 'audit_logs'; break;
      default:
        return res.status(400).json({ success: false, error: '无效的资源类型' });
    }

    // 构建 SELECT 字段列表
    let selectFields = '*';
    if (fields && Array.isArray(fields) && fields.length > 0) {
      // 只允许安全的字段名
      const allowedFields = ['id', 'name', 'email', 'status', 'title', 'description', 'created_at', 'updated_at', 'assignee_id', 'type'];
      const safeFields = fields.filter(f => allowedFields.includes(f));
      if (safeFields.length > 0) {
        selectFields = safeFields.join(', ');
      }
    }

    const sql = `SELECT ${selectFields} FROM ${tableName} WHERE id IN (${idPlaceholders})`;
    const data = await query(sql, ids);

    logger.info(`批量查询 ${resource}: 查询到 ${data.length} 条记录`);

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    logger.error('批量查询失败:', error.message);
    res.status(500).json({
      success: false,
      error: '批量查询失败'
    });
  }
}

module.exports = {
  batchDelete,
  batchUpdateStatus,
  batchExport,
  batchAssign,
  batchGet
};
