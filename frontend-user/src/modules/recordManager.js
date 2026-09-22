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
        logger.info('加载记录成功', { count: records.length });
        return records;
      }
    } catch (error) {
      logger.error('加载记录失败', error);
    }
    return [];
  }

  /**
   * 提交记录变更（事务式）
   * 先将目标状态写入 localStorage，写入成功后才更新内存；
   * 写入失败时内存保持写之前的状态，并抛出明确原因的异常
   * @param {Array} nextRecords - 要保存的完整记录数组
   */
  commitRecords(nextRecords) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(nextRecords));
    } catch (error) {
      logger.error('写入存储失败，已回退到写之前的状态', error);
      if (this.isQuotaError(error)) {
        throw new Error('存储空间已满，本次操作未保存。请删除部分记录或清理浏览器存储后重试');
      }
      throw new Error(`记录保存失败，本次操作未保存：${error && error.message ? error.message : '未知错误'}`);
    }
    this.records = nextRecords;
    logger.info('保存记录成功', { count: nextRecords.length });
  }

  /**
   * 判断是否为存储空间不足错误
   * @param {Error} error - 原始错误
   * @returns {boolean} 是否为配额超限
   */
  isQuotaError(error) {
    return Boolean(error) && (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    );
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
   * @throws {Error} 记录数量已达上限或写入存储失败时抛出异常，内存状态保持不变
   */
  createRecord(recordData) {
    if (this.records.length >= this.MAX_RECORDS) {
      logger.warn('创建记录被拒绝：已达数量上限', { max: this.MAX_RECORDS });
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

    this.commitRecords([record, ...this.records]);
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
   * @throws {Error} 写入存储失败时抛出异常，内存状态保持不变
   */
  updateRecord(id, updates) {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn('未找到要更新的记录', { id });
      return null;
    }

    const nextRecords = [...this.records];
    nextRecords[index] = { ...nextRecords[index], ...updates };
    this.commitRecords(nextRecords);
    logger.info('更新记录', { id });

    return this.records[index];
  }

  /**
   * 删除记录
   * @param {string} id - 记录 ID
   * @returns {boolean} 是否删除成功
   * @throws {Error} 写入存储失败时抛出异常，内存状态保持不变
   */
  deleteRecord(id) {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn('未找到要删除的记录', { id });
      return false;
    }

    this.commitRecords(this.records.filter(r => r.id !== id));
    logger.info('删除记录', { id });

    return true;
  }

  /**
   * 清空所有记录
   * @throws {Error} 写入存储失败时抛出异常，内存状态保持不变
   */
  clearAllRecords() {
    this.commitRecords([]);
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
   * 导入记录（事务式：全部验证通过且不超上限才写入，任一失败则整体不导入）
   * @param {string} jsonData - JSON 字符串
   * @returns {number} 导入的记录数量
   * @throws {Error} 数据格式无效、超过数量上限或写入存储失败时抛出异常，内存状态保持不变
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
    const validRecords = records.filter(record => this.validateRecord(record));

    if (validRecords.length === 0) {
      logger.warn('导入记录失败：没有有效记录');
      throw new Error('导入记录失败，数据格式无效');
    }

    if (this.records.length + validRecords.length > this.MAX_RECORDS) {
      logger.warn('导入记录被拒绝：将超过数量上限', {
        current: this.records.length,
        importing: validRecords.length,
        max: this.MAX_RECORDS
      });
      throw new Error(`导入 ${validRecords.length} 条记录将超过上限（${this.MAX_RECORDS} 条），请先删除部分现有记录`);
    }

    const imported = validRecords.map(record => ({
      ...record,
      id: this.generateId(),
      createdAt: Date.now()
    }));

    this.commitRecords([...imported, ...this.records]);
    logger.info('导入记录', { count: imported.length });
    return imported.length;
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
