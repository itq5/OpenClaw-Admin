/**
 * 数据导入服务
 * 负责数据恢复、导入功能
 * 支持 Excel/CSV/PDF 格式
 */

const db = require('../utils/database');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { parse } = require('csv-parse');
const PDFDocument = require('pdfkit');

class ImportService {
  constructor() {
    this.importDir = path.join(__dirname, '../../data/imports');
    this.ensureImportDir();
  }

  /**
   * 确保导入目录存在
   */
  ensureImportDir() {
    if (!fs.existsSync(this.importDir)) {
      fs.mkdirSync(this.importDir, { recursive: true });
    }
  }

  /**
   * 解析 Excel 文件
   * @param {string} filePath - Excel 文件路径
   * @returns {Array} - 数据数组
   */
  parseExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
  }

  /**
   * 解析 CSV 文件
   * @param {string} filePath - CSV 文件路径
   * @returns {Promise<Array>} - 数据数组
   */
  parseCsvFile(filePath) {
    return new Promise((resolve, reject) => {
      const records = [];
      fs.createReadStream(filePath)
        .pipe(parse({ columns: true, skip_empty_lines: true }))
        .on('data', (record) => records.push(record))
        .on('end', () => resolve(records))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * 解析 PDF 文件（提取表格数据）
   * @param {string} filePath - PDF 文件路径
   * @returns {Promise<Array>} - 数据数组
   */
  async parsePdfFile(filePath) {
    // PDF 解析简化处理，实际应使用 pdf-parse 或类似库
    // 这里返回空数组表示不支持直接解析 PDF 数据
    console.warn('PDF 导入功能需要额外的 PDF 解析库，当前仅支持 Excel 和 CSV');
    return [];
  }

  /**
   * 完整数据恢复导入
   * @param {string} filePath - ZIP 文件路径
   * @param {string} mode - 导入模式：merge（保留现有）/ replace（清空现有）
   * @returns {object} - 导入结果
   */
  async importFullBackup(filePath, mode = 'merge') {
    const importId = crypto.randomUUID();
    const timestamp = Date.now();
    
    try {
      // 验证文件存在
      if (!fs.existsSync(filePath)) {
        throw new Error('导入文件不存在');
      }

      // 解压文件（这里简化处理，假设是 JSON 格式）
      // 实际应该使用 adm-zip 解压
      const tempDir = path.join(this.importDir, `temp_${importId}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // 读取 metadata
      const metadataPath = path.join(tempDir, 'metadata.json');
      if (!fs.existsSync(metadataPath)) {
        throw new Error('无效的备份文件：缺少 metadata.json');
      }

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

      // 导入各个表
      const results = {
        import_id: importId,
        mode,
        tables: [],
        total_imported: 0,
        total_skipped: 0,
        errors: []
      };

      // 定义导入顺序（考虑外键依赖）
      const importOrder = [
        'users', 'roles', 'permissions', 'user_roles', 'role_permissions',
        'sessions', 'audit_logs', 'two_factor_auth',
        'waf_rules', 'waf_logs', 'cicd_scans', 'cicd_scan_results',
        'crons', 'cron_runs', 'env_configs'
      ];

      for (const table of importOrder) {
        const tablePath = path.join(tempDir, `${table}.json`);
        if (fs.existsSync(tablePath)) {
          try {
            const tableResult = await this.importTableData(table, tablePath, mode);
            results.tables.push(tableResult);
            results.total_imported += tableResult.imported;
            results.total_skipped += tableResult.skipped;
          } catch (e) {
            results.errors.push({ table, error: e.message });
          }
        }
      }

      // 清理临时目录
      fs.rmSync(tempDir, { recursive: true, force: true });

      // 记录导入历史
      await this.recordImportHistory({
        import_type: 'full_backup',
        file_name: path.basename(filePath),
        record_count: results.total_imported,
        status: results.errors.length === 0 ? 'completed' : 'partial',
        error_message: results.errors.length > 0 ? JSON.stringify(results.errors) : null,
        created_by: null
      });

      return {
        success: true,
        import_id: importId,
        ...results
      };
    } catch (e) {
      console.error('Import failed:', e);
      
      await this.recordImportHistory({
        import_type: 'full_backup',
        file_name: path.basename(filePath),
        record_count: 0,
        status: 'failed',
        error_message: e.message,
        created_by: null
      });

      throw e;
    }
  }

  /**
   * 导入单个资源类型
   * @param {string} resourceType - 资源类型
   * @param {string} filePath - 文件路径
   * @param {string} mode - 导入模式
   * @returns {object} - 导入结果
   */
  async importResource(resourceType, filePath, mode = 'merge') {
    const importId = crypto.randomUUID();
    
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('导入文件不存在');
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      let data;

      if (resourceType.endsWith('.json')) {
        data = JSON.parse(content);
      } else if (resourceType.endsWith('.csv')) {
        data = this.csvToJson(content);
      } else {
        throw new Error('不支持的文件格式');
      }

      if (!Array.isArray(data)) {
        data = [data];
      }

      const result = await this.importTableData(resourceType, filePath, mode, data);

      await this.recordImportHistory({
        import_type: `resource_${resourceType}`,
        file_name: path.basename(filePath),
        record_count: result.imported,
        status: 'completed',
        created_by: null
      });

      return {
        success: true,
        import_id: importId,
        ...result
      };
    } catch (e) {
      console.error('Import failed:', e);
      throw e;
    }
  }

  /**
   * 导入表数据
   * @param {string} tableName - 表名
   * @param {string} filePath - 文件路径
   * @param {string} mode - 导入模式
   * @param {Array} data - 数据（可选，直接从内存导入）
   * @returns {object} - 导入结果
   */
  async importTableData(tableName, filePath, mode, data = null) {
    if (!data) {
      const content = fs.readFileSync(filePath, 'utf-8');
      data = JSON.parse(content);
    }

    if (!Array.isArray(data) || data.length === 0) {
      return { table: tableName, imported: 0, skipped: 0 };
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    if (mode === 'replace') {
      // 清空表
      try {
        await db.query(`DELETE FROM ${tableName}`);
      } catch (e) {
        console.error(`Failed to truncate ${tableName}:`, e.message);
      }
    }

    for (const record of data) {
      try {
        if (mode === 'merge') {
          // 检查是否已存在
          const existing = await db.query(
            `SELECT id FROM ${tableName} WHERE id = ?`,
            [record.id]
          );

          if (existing && existing.length > 0) {
            skipped++;
            continue;
          }
        }

        // 插入数据
        const fields = Object.keys(record);
        const placeholders = fields.map(() => '?').join(',');
        const values = fields.map(f => record[f]);

        await db.query(
          `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`,
          values
        );

        imported++;
      } catch (e) {
        errors.push({ record: record.id, error: e.message });
        console.error(`Failed to import record ${record.id}:`, e.message);
      }
    }

    return {
      table: tableName,
      imported,
      skipped,
      errors
    };
  }

  /**
   * CSV 转 JSON
   * @param {string} csv - CSV 内容
   * @returns {Array} - JSON 数组
   */
  csvToJson(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || null;
      });
      data.push(obj);
    }

    return data;
  }

  /**
   * 记录导入历史
   * @param {object} data - 导入信息
   */
  async recordImportHistory(data) {
    try {
      await db.query(`
        INSERT INTO import_history (
          import_type, file_name, record_count, 
          status, error_message, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        data.import_type,
        data.file_name,
        data.record_count || 0,
        data.status || 'pending',
        data.error_message || null,
        data.created_by || null,
        data.created_at || Date.now()
      ]);
    } catch (e) {
      console.error('Failed to record import history:', e.message);
    }
  }

  /**
   * 获取导入历史
   * @param {object} options - 选项
   * @returns {Array} - 导入历史列表
   */
  async getImportHistory(options = {}) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    try {
      const result = await db.query(`
        SELECT * FROM import_history 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `, [limit, offset]);

      return result || [];
    } catch (e) {
      console.error('Failed to get import history:', e.message);
      return [];
    }
  }
}

module.exports = new ImportService();
