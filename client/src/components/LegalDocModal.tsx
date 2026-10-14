// ===== 协议 / 条款弹窗 =====
// 商城与登录页的《用户协议》《隐私政策》此前都是 href="#"，
// 点了什么都不发生。这里给出可读的正文，避免「按了无效」。
//
// 原来还有《用户付费协议》和《充值条款》两篇，整篇在讲微信/支付宝支付、
// 充值档位、订单有效期、开发票 —— 本项目**不做充值系统**，金币只能靠
// 赢牌和签到获得，这两篇既没有任何入口引用，内容也会误导玩家以为能花钱，
// 所以整体删除。

import { useEffect } from 'react';
import { CloseIcon } from './icons';
import '../styles/legalDoc.css';

export type LegalDocId = 'terms' | 'privacy';

interface DocContent {
  title: string;
  updated: string;
  sections: { heading: string; body: string[] }[];
}

const DOCS: Record<LegalDocId, DocContent> = {
  terms: {
    title: '用户协议',
    updated: '2026-01-01',
    sections: [
      {
        heading: '一、账号规范',
        body: [
          '一人一号，请勿将账号出租、出借或转让给他人使用。',
          '昵称与头像不得包含违法、侮辱、色情或冒充官方的内容。',
        ],
      },
      {
        heading: '二、游戏公平',
        body: [
          '严禁使用外挂、脚本、多开合谋、代打等破坏公平的行为。',
          '经核实的违规行为将按情节给予警告、禁赛、封号处理，虚拟物品不予返还。',
        ],
      },
      {
        heading: '三、服务变更',
        body: [
          '官方可能因版本更新、维护、法律要求等原因调整或中止部分功能，会尽量提前公告。',
        ],
      },
    ],
  },
  privacy: {
    title: '隐私政策',
    updated: '2026-01-01',
    sections: [
      {
        heading: '一、收集的信息',
        body: [
          '为完成对局撮合与战绩记录，我们会收集昵称、账号标识、对局结果与设备基础信息。',
          '不会收集通讯录、短信内容、精确定位等与游戏无关的信息。',
        ],
      },
      {
        heading: '二、本地存储',
        body: [
          '昵称、金币、战绩、音效与震动开关等偏好保存在本机浏览器中，清除浏览器数据即会丢失。',
        ],
      },
      {
        heading: '三、信息共享',
        body: [
          '除法律要求或您明确授权外，我们不会将您的信息提供给第三方。',
          '支付环节由支付渠道处理，我们不接触您的银行卡号与支付密码。',
        ],
      },
      {
        heading: '四、联系方式',
        body: [
          '如需查询、更正或删除个人信息，可通过「客服与反馈」联系我们。',
        ],
      },
    ],
  },
};

export function LegalDocModal({ doc, onClose }: { doc: LegalDocId; onClose: () => void }) {
  const content = DOCS[doc];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="legal-doc-mask" onClick={onClose}>
      <div className="legal-doc" onClick={e => e.stopPropagation()} role="dialog" aria-label={content.title}>
        <header className="legal-doc-head">
          <div>
            <div className="legal-doc-title">{content.title}</div>
            <div className="legal-doc-updated">更新日期：{content.updated}</div>
          </div>
          <button className="legal-doc-close" onClick={onClose} aria-label="关闭"><CloseIcon size={16} tone="gold" /></button>
        </header>
        <div className="legal-doc-body">
          {content.sections.map(sec => (
            <section key={sec.heading} className="legal-doc-section">
              <h4 className="legal-doc-heading">{sec.heading}</h4>
              {sec.body.map((line, i) => (
                <p key={i} className="legal-doc-para">{line}</p>
              ))}
            </section>
          ))}
        </div>
        <footer className="legal-doc-foot">
          <button className="legal-doc-ok" onClick={onClose}>我已阅读</button>
        </footer>
      </div>
    </div>
  );
}
