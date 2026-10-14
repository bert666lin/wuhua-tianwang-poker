// ===== 对局界面页面 =====
// 从Colyseus实时状态驱动所有UI渲染

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Card, Suit, RoomState, SettlementResult, BidEvent, ActionType } from '../types';
import type { GameActions } from '../hooks/useColyseus';
import { TableV4Adapter } from '../components/TableV4Adapter';
import { OrientationLock } from '../components/OrientationLock';
import { describeSelection } from '../utils/pattern';
import { getModeLabel } from '../utils/modeSelection';

interface GameProps {
  roomState: RoomState;
  myPlayerId: string;
  myHand: Card[];
  /** 发牌序号：自增即重播发牌动画，透传给牌桌。 */
  dealKey: number;
  bottomCards: Card[];
  settlementResult: SettlementResult | null;
  bidHistory: BidEvent[];
  roomId: string | null;
  error: string | null;
  turnDeadline: number | null;
  hintCardIds: string[];
  hintInfo: { seq: number; index: number; total: number } | null;
  lastTrickPlays: Record<number, Card[]>;
  autoPlaySeat: number | null;
  isReconnecting: boolean;
  /** 重连窗口截止时间戳，遮罩上倒计时用 */
  reconnectDeadline: number | null;
  isTrustee: boolean;
  tossNotice: string | null;
  scorePopup: { score: number; seat: number; key: number } | null;
  chatMessages: import('../types').ChatMessage[];
  discardHintIds: string[];
  /** 分批扣牌：已放进底牌区的牌。 */
  stagedDiscards: Card[];
  /** 实时语音：本机能否录音 / 我是否正在说话 / 谁在说话 / 听筒是否关着。 */
  voiceSupported: boolean;
  isTalking: boolean;
  /** 自己麦克风实时电平 0~1，透给牌桌画音量反馈。 */
  micLevel: number;
  speakingIds: string[];
  voiceMuted: boolean;
  actions: GameActions;
}

const TableComp = TableV4Adapter as any;

export function Game({ roomState, myPlayerId, myHand, dealKey, settlementResult, bidHistory, roomId, error, turnDeadline, hintCardIds, hintInfo, lastTrickPlays, autoPlaySeat, scorePopup, chatMessages, discardHintIds, stagedDiscards, isReconnecting, reconnectDeadline, isTrustee, tossNotice, voiceSupported, isTalking, micLevel, speakingIds, voiceMuted, actions }: GameProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 收到扣底推荐时自动选中
  useEffect(() => {
    if (roomState.phase === 'discarding' && discardHintIds.length > 0) {
      setSelectedIds(new Set(discardHintIds));
    }
  }, [discardHintIds, roomState.phase]);

  // 找到当前玩家
  const myPlayer = useMemo(
    () => roomState.players.find(p => p.id === myPlayerId),
    [roomState.players, myPlayerId]
  );

  const mySeat = myPlayer?.seatIndex ?? 0;
  const isMyTurn = roomState.currentTurn === mySeat;

  /**
   * 可叫主/可抢主的花色。
   *
   * 抢主门槛：已有人叫主时，必须用【更多】张同花色的 7 才能抢
   * （别人用1张♦7叫主，我要抢就得有2张♦7，或2张其他花色的7）。
   * 这里的门槛必须和服务端 handleCallSuit 保持一致，否则会点了报错。
   */
  const minSevens = roomState.mainSuit === null ? 1 : roomState.mainSuitCallCount + 1;
  const availableSuits: Suit[] = useMemo(() => {
    const need = roomState.mainSuit === null ? 1 : roomState.mainSuitCallCount + 1;
    const countOf = (suit: Suit) =>
      myHand.filter(c => c.suit === suit && c.rank === '7').length;
    return (['spade', 'heart', 'diamond', 'club'] as Suit[])
      .filter(suit => countOf(suit) >= need);
  }, [myHand, roomState.mainSuit, roomState.mainSuitCallCount]);

  // 当前选中的牌
  const selectedCards = useMemo(
    () => myHand.filter(c => selectedIds.has(c.id)),
    [myHand, selectedIds]
  );

  // 切换选中/取消选中
  const handleCardToggle = useCallback((card: Card) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });
  }, []);

  // 清除选中
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // 阶段变化时清除选中
  useEffect(() => {
    clearSelection();
  }, [roomState.phase, clearSelection]);

  /* 收到提示结果时，自动选中推荐的牌。
   *
   * 依赖必须是 hintInfo.seq（每次提示都自增）而不是 hintCardIds ——
   * 反复按提示轮到某一套方案时，牌可能和上一次相同，数组内容一样的话
   * useEffect 不会重跑，玩家会觉得"提示按了没反应"。 */
  useEffect(() => {
    if (hintCardIds.length > 0) {
      setSelectedIds(new Set(hintCardIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintInfo?.seq]);

  // 操作回调 - 分发到对应的Colyseus消息
  const handleAction = useCallback((action: ActionType, value?: number | string) => {
    switch (action) {
      case 'ready':
        actions.sendReady();
        break;
      case 'play':
        if (selectedCards.length > 0) {
          actions.sendPlay(selectedCards);
          clearSelection();
        }
        break;
      case 'call_suit':
        if (typeof value === 'string') {
          actions.sendCallSuit(value as Suit);
        }
        break;
      case 'call_score':
        if (typeof value === 'number') {
          actions.sendCallScore(value);
        }
        break;
      case 'pass':
        actions.sendPass();
        break;
      case 'discard': {
        /* 分批扣牌：选中的牌先放进底牌区，凑够张数由服务端自动结算。
         *
         * 扣底张数随模式变化（两副12张、三副18张、5人局17张），一次性从
         * 三四十张手牌里精准挑齐很痛苦，所以允许分几次放。
         * 剩余张数以服务端暂存区为准（stagedDiscards），不能用本地累加。 */
        const remaining = roomState.bottomCount - stagedDiscards.length;
        /* 张数已经凑齐 -> 这一下是「确认埋底」，不是继续放牌。
         * TableV4 的主按钮此时也把文字换成了「确认埋底」，两边必须一致，
         * 否则按钮写着确认却什么都不发生。 */
        if (remaining <= 0) {
          actions.confirmDiscard();
          clearSelection();
          break;
        }
        if (selectedCards.length === 0) break;
        if (selectedCards.length > remaining) break; // 超量由服务端兜底报错
        actions.stageDiscard(selectedCards);
        clearSelection();
        break;
      }
      case 'toss':
        // 甩牌：服务端会做压制判定，失败时自动改为只出最小一张
        if (selectedCards.length >= 2) {
          actions.sendToss(selectedCards);
          clearSelection();
        }
        break;
      case 'next':
        actions.sendReady();
        clearSelection();
        break;
      default:
        break;
    }
  }, [actions, selectedCards, clearSelection, roomState.bottomCount, stagedDiscards.length]);

  return (
    <OrientationLock enabled>
      <TableComp
        players={roomState.players}
        mySeat={mySeat}
        phase={roomState.phase}
        mainSuit={roomState.mainSuit}
        bankerSeat={roomState.bankerSeat}
        callScore={roomState.callScore}
        nextBidMax={roomState.nextBidMax}
        currentTurn={roomState.currentTurn}
        lastWinner={roomState.lastWinner}
        trickLeader={roomState.trickLeader}
        lastTrick={roomState.lastTrick}
        currentPlays={roomState.currentPlays}
        currentWinnerSeat={roomState.currentWinnerSeat}
        requiredPlayCount={roomState.requiredPlayCount}
        myHand={myHand}
        dealKey={dealKey}
        selectedIds={selectedIds}
        onCardToggle={handleCardToggle}
        onSelectionChange={setSelectedIds}
        onAction={handleAction}
        roomId={roomId}
        error={error}
        isReconnecting={isReconnecting}
        reconnectDeadline={reconnectDeadline}
        turnDeadline={turnDeadline}
        hintCardIds={hintCardIds}
        hintInfo={hintInfo}
        lastTrickPlays={lastTrickPlays}
        autoPlaySeat={autoPlaySeat}
        scorePopup={scorePopup}
        chatMessages={chatMessages}
        availableSuits={availableSuits}
        minSevens={minSevens}
        selectedCount={selectedCards.length}
        isMyTurn={isMyTurn}
        settlementResult={settlementResult}
        bidHistory={bidHistory}
        onLeave={actions.leaveRoom}
        onHint={actions.sendHint}
        onDiscardHint={actions.sendDiscardHint}
        onChat={actions.sendChat}
        voiceSupported={voiceSupported}
        isTalking={isTalking}
        micLevel={micLevel}
        onVoiceStart={actions.startVoice}
        onVoiceStop={actions.stopVoice}
        speakingIds={speakingIds}
        voiceMuted={voiceMuted}
        onToggleVoiceMuted={() => actions.setVoiceMuted(!voiceMuted)}
        onClearSelection={clearSelection}
        onReturnToLobby={actions.returnToLobby}
        /* 换成 describeSelection：老的 describePattern 不收 mainSuit，判不出
           「主副不能混组」（主♠时 ♦6♦6+♦7♦7 它会标成拖拉机，服务端却拒绝），
           也认不出连三张/王组合。见 utils/pattern.ts 的说明。 */
        selectedPattern={describeSelection(selectedCards, roomState.mainSuit)}
        isTrustee={isTrustee}
        tossNotice={tossNotice}
        onResumeControl={actions.resumeControl}
        playerLimit={roomState.modePlayerCount}
        modeName={getModeLabel(roomState.modeId) ?? `${roomState.modePlayerCount}人 局`}
        discardCount={roomState.bottomCount}
        stagedDiscards={stagedDiscards}
        onUnstageDiscard={actions.unstageDiscard}
        /* 埋底要庄家显式确认，服务端不再凑够张数就自动开打 */
        onConfirmDiscard={actions.confirmDiscard}
        /* 叫主/抢主/叫分过程：顶栏标明主是谁叫的，记录面板列全过程 */
        auction={roomState.auction}
        /* 房间累计战绩：顶栏「第N局 +M级」、记录面板逐局明细、退房清单都用它。
           来自服务端 state（不是广播累积），所以重连和中途加入也看得到。 */
        history={roomState.history}
        roundsPlayed={roomState.roundsPlayed}
        onAddAi={actions.addAi}
        onRemoveAi={actions.removeAi}
        onKickPlayer={actions.kickPlayer}
      />
    </OrientationLock>
  );
}
