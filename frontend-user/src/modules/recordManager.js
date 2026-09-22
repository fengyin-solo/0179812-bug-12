import { Logger } from '../utils/logger.js';

const logger = new Logger('RecordManager');

/**
 * 记录管理器 - 负责保存、加载、删除音频分析记录
 */
export class RecordManager {
  constructor() {
    this.STORAGE_KEY = 'guqin_audio_records';
    this.MAX_RECORDS = 50;
    this.records = this.loadRecords();
  }

  /**
   * 从 localStorage 加载记录
   * @returns {Array} 记录数组
   */
  loadRecords() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const records = JSON.parse(data);
        if (!Array.isArray(records)) {
          logger.warn('存储的记录数据格式无效，已忽略');
          return [];
        }
        logger.info('加载记录成功', { count: records.length });
        return records;
      }
    } catch (error) {
      logger.error('加载记录失败', error);
    }
    return [];
  }

  /**
   * 保存记录到 localStorage
   * 失败时抛出带明确原因的错误
   */
  saveRecords() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.records));
      logger.info('保存记录成功', { count: this.records.length });
    } catch (error) {
      logger.error('保存记录失败', error);
      if (this.isQuotaExceededError(error)) {
        throw new Error('存储空间已满，记录未保存。请删除部分历史记录或清理浏览器存储后重试');
      }
      const reason = error && error.message ? error.message : '未知原因';
      throw new Error(`保存记录失败：${reason}`);
    }
  }

  /**
   * 判断是否为存储空间不足错误
   * @param {*} error - 捕获的错误
   * @returns {boolean} 是否为配额超限错误
   */
  isQuotaExceededError(error) {
    if (!error) return false;
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 || // 旧版浏览器 QUOTA_EXCEEDED_ERR
      error.code === 1014 // 旧版 Firefox NS_ERROR_DOM_QUOTA_REACHED
    );
  }

  /**
   * 事务式提交：先变更内存数据再写入存储，
   * 写入失败时回滚到变更前的状态，保证内存与存储始终一致
   * @param {Function} mutate - 对 this.records 的变更操作
   */
  commit(mutate) {
    const snapshot = this.records.slice();
    try {
      mutate();
      this.saveRecords();
    } catch (error) {
      this.records = snapshot;
      logger.warn('写入失败，已回滚到变更前状态', { count: snapshot.length });
      throw error;
    }
  }

  /**
   * 创建新记录
   * @param {Object} recordData - 记录数据
   * @param {string} recordData.fileName - 文件名
   * @param {number} recordData.startMs - 起始时间 (ms)
   * @param {number} recordData.endMs - 结束时间 (ms)
   * @param {number} recordData.fundamentalFreq - 基频
   * @param {Array} recordData.harmonics - 倍频数组
   * @param {Object} recordData.harmonicIntensities - 倍频强度
   * @param {Object} recordData.analysisResult - 完整分析结果
   * @param {string} recordData.name - 记录名称（可选）
   * @param {string} recordData.note - 备注（可选）
   * @returns {Object} 创建的记录
   */
  createRecord(recordData) {
    if (this.records.length >= this.MAX_RECORDS) {
      logger.warn('创建记录被拒绝：已达数量上限', { count: this.records.length });
      throw new Error(`记录数量已达上限（${this.MAX_RECORDS} 条），请先删除部分记录后再保存`);
    }

    const record = {
      id: this.generateId(),
      name: recordData.name || `${recordData.fileName} - ${this.formatTimestamp()}`,
      fileName: recordData.fileName,
      startMs: recordData.startMs,
      endMs: recordData.endMs,
      durationMs: recordData.endMs - recordData.startMs,
      fundamentalFreq: recordData.fundamentalFreq,
      harmonics: recordData.harmonics,
      harmonicIntensities: recordData.harmonicIntensities,
      analysisResult: recordData.analysisResult,
      createdAt: Date.now(),
      note: recordData.note || ''
    };

    this.commit(() => {
      this.records.unshift(record);
    });
    logger.info('创建新记录', { id: record.id, name: record.name });

    return record;
  }

  /**
   * 获取所有记录
   * @returns {Array} 记录数组
   */
  getAllRecords() {
    return [...this.records];
  }

  /**
   * 根据 ID 获取记录
   * @param {string} id - 记录 ID
   * @returns {Object|null} 记录对象
   */
  getRecord(id) {
    return this.records.find(r => r.id === id) || null;
  }

  /**
   * 更新记录
   * @param {string} id - 记录 ID
   * @param {Object} updates - 要更新的字段
   * @returns {Object|null} 更新后的记录
   */
  updateRecord(id, updates) {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn('未找到要更新的记录', { id });
      return null;
    }

    this.commit(() => {
      this.records[index] = { ...this.records[index], ...updates };
    });
    logger.info('更新记录', { id });

    return this.records[index];
  }

  /**
   * 删除记录
   * @param {string} id - 记录 ID
   * @returns {boolean} 是否删除成功
   */
  deleteRecord(id) {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn('未找到要删除的记录', { id });
      return false;
    }

    this.commit(() => {
      this.records.splice(index, 1);
    });
    logger.info('删除记录', { id });

    return true;
  }

  /**
   * 清空所有记录
   */
  clearAllRecords() {
    this.commit(() => {
      this.records = [];
    });
    logger.info('清空所有记录');
  }

  /**
   * 生成唯一 ID
   * @returns {string} 唯一 ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 格式化时间戳
   * @returns {string} 格式化的时间字符串
   */
  formatTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * 格式化日期显示
   * @param {number} timestamp - 时间戳
   * @returns {string} 格式化的日期字符串
   */
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} 小时前`;
    } else if (diff < 604800000) {
      return `${Math.floor(diff / 86400000)} 天前`;
    } else {
      return this.formatTimestampFull(timestamp);
    }
  }

  /**
   * 完整格式化时间戳
   * @param {number} timestamp - 时间戳
   * @returns {string} 格式化的时间字符串
   */
  formatTimestampFull(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * 导出记录为 JSON
   * @param {string} id - 记录 ID（可选，不传则导出所有）
   * @returns {string} JSON 字符串
   */
  exportRecords(id = null) {
    const data = id ? this.getRecord(id) : this.getAllRecords();
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入记录（整体原子操作：全部成功或全部不导入）
   * @param {string} jsonData - JSON 字符串
   * @returns {number} 导入的记录数量
   */
  importRecords(jsonData) {
    let data;
    try {
      data = JSON.parse(jsonData);
    } catch (error) {
      logger.error('导入记录失败：JSON 解析错误', error);
      throw new Error('导入记录失败，数据格式无效');
    }

    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) {
      return 0;
    }

    const invalidCount = records.filter(r => !this.validateRecord(r)).length;
    if (invalidCount > 0) {
      logger.warn('导入记录被拒绝：存在无效记录', { invalidCount });
      throw new Error(`导入记录失败，${invalidCount} 条记录数据格式无效`);
    }

    const available = this.MAX_RECORDS - this.records.length;
    if (records.length > available) {
      logger.warn('导入记录被拒绝：超出数量上限', {
        current: this.records.length,
        importing: records.length,
        available
      });
      throw new Error(
        `导入记录失败，当前已有 ${this.records.length} 条记录，最多还可导入 ${available} 条` +
        `（本次共 ${records.length} 条），请先删除部分记录`
      );
    }

    const now = Date.now();
    const prepared = records.map(record => ({
      ...record,
      id: this.generateId(),
      createdAt: now
    }));

    this.commit(() => {
      this.records = [...prepared, ...this.records];
    });
    logger.info('导入记录', { count: prepared.length });
    return prepared.length;
  }

  /**
   * 验证记录数据
   * @param {Object} record - 记录数据
   * @returns {boolean} 是否有效
   */
  validateRecord(record) {
    return (
      record &&
      typeof record.fileName === 'string' &&
      typeof record.startMs === 'number' &&
      typeof record.endMs === 'number' &&
      typeof record.fundamentalFreq === 'number' &&
      Array.isArray(record.harmonics)
    );
  }
}
