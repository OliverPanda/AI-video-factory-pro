/**
 * 用户友好的错误消息翻译
 * 将技术性错误信息转换为普通用户能理解的描述
 */

/**
 * 把技术错误信息翻译成用户友好的中文提示
 * @param {string} rawMessage - 原始错误信息（通常是 axios 或系统错误）
 * @returns {{ friendly: string; hint: string; category: string }}
 */
export function friendlyError(rawMessage) {
  const msg = String(rawMessage || '').trim();

  // ── HTTP 状态码 ──────────────────────────────────────────
  if (/status code 401/i.test(msg)) {
    return {
      friendly: 'API 密钥无效或已过期',
      hint: '请检查 .env 文件中的 API Key 是否正确，或者到对应平台重新生成密钥。',
      category: 'auth',
    };
  }

  if (/status code 403/i.test(msg)) {
    return {
      friendly: 'API 访问被拒绝',
      hint: '可能原因：① API Key 没有该模型的访问权限；② 账户余额不足或已欠费；③ 该模型未开通。请登录对应平台（如阿里云 DashScope）检查账户状态和模型权限。',
      category: 'auth',
    };
  }

  if (/status code 404/i.test(msg)) {
    return {
      friendly: 'API 接口不存在',
      hint: '请检查 .env 中的 BASE_URL 是否正确，或确认所使用的模型名称是否拼写无误。',
      category: 'config',
    };
  }

  if (/status code 429/i.test(msg)) {
    return {
      friendly: 'API 请求过于频繁',
      hint: '当前 API 调用频率超过了服务商限制。可以稍等几分钟后重试，或检查账户的并发额度。',
      category: 'rate_limit',
    };
  }

  if (/status code 5\d{2}/i.test(msg)) {
    const code = msg.match(/status code (\d{3})/i)?.[1] || '5xx';
    return {
      friendly: `AI 服务暂时不可用（${code}）`,
      hint: '这是服务商端的问题，通常几分钟后会自动恢复。请稍后重试。',
      category: 'server',
    };
  }

  // ── 网络 / 连接错误 ──────────────────────────────────────
  if (/ECONNREFUSED/i.test(msg)) {
    return {
      friendly: '无法连接到 AI 服务',
      hint: '请检查网络连接是否正常，以及 .env 中的 BASE_URL 地址是否正确。',
      category: 'network',
    };
  }

  if (/ETIMEDOUT|timeout/i.test(msg)) {
    return {
      friendly: 'AI 服务响应超时',
      hint: '请求等待时间过长。可能是网络不稳定或 AI 服务繁忙，请稍后重试。如果反复出现，可检查网络环境或换用其他 LLM 服务商。',
      category: 'network',
    };
  }

  if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
    return {
      friendly: '无法解析 AI 服务域名',
      hint: '请检查网络连接和 DNS 设置，确认 .env 中的 BASE_URL 地址可以正常访问。',
      category: 'network',
    };
  }

  // ── 图像 / 视频生成失败 ─────────────────────────────────
  if (/image.*(?:failed|error|generat)/i.test(msg) || /(?:failed|error).*image/i.test(msg)) {
    return {
      friendly: '图片生成失败',
      hint: '可能是图像生成服务的 API Key 异常或额度用尽，请检查对应的图像服务配置。',
      category: 'media',
    };
  }

  if (/video.*(?:failed|error|generat)/i.test(msg) || /(?:failed|error).*video/i.test(msg)) {
    return {
      friendly: '视频生成失败',
      hint: '可能是视频生成服务的 API Key 异常或额度用尽，请检查对应的视频服务配置。',
      category: 'media',
    };
  }

  // ── LLM 特定错误 ─────────────────────────────────────────
  if (/model.*not\s*found|invalid\s*model|model.*does\s*not\s*exist/i.test(msg)) {
    return {
      friendly: 'AI 模型不可用',
      hint: '请检查 .env 中配置的模型名称是否正确，或该模型是否已在服务商平台开通。',
      category: 'config',
    };
  }

  if (/quota|balance|insufficient|余额/i.test(msg)) {
    return {
      friendly: 'API 额度不足',
      hint: '账户余额已用完或免费额度已耗尽，请登录对应平台充值或更换 API Key。',
      category: 'billing',
    };
  }

  // ── 内部错误 ─────────────────────────────────────────────
  if (/Cannot read propert/i.test(msg) || /TypeError/i.test(msg)) {
    return {
      friendly: '程序内部错误',
      hint: '这是一个软件 Bug，请将错误信息反馈给开发者以便修复。',
      category: 'bug',
    };
  }

  if (/Episode not found/i.test(msg)) {
    return {
      friendly: '找不到对应的剧集数据',
      hint: '剧本可能没有正确上传或分集信息缺失，请尝试重新上传剧本。',
      category: 'data',
    };
  }

  // ── 兜底 ────────────────────────────────────────────────
  return {
    friendly: msg.length > 80 ? '运行过程中出现错误' : msg || '未知错误',
    hint: '如果问题持续出现，请截图并反馈给开发者。',
    category: 'unknown',
  };
}

/**
 * 将原始错误消息包装为 "友好标题 + 原始详情" 格式
 * 用于写入 run-job 的 error 字段
 * @param {string} rawMessage
 * @returns {string}
 */
export function formatRunError(rawMessage) {
  const { friendly, hint } = friendlyError(rawMessage);
  return `${friendly}\n💡 ${hint}\n\n── 技术详情 ──\n${rawMessage}`;
}
