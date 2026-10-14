// ===== 真实数据 V4 桌面（dev 预览） =====
import { useState } from 'react';
import { TableV4Adapter } from '../components/TableV4Adapter';
import { useColyseus } from '../hooks/useColyseus';

export function GameV4Real() {
  const {
    roomState,
    myPlayerId,
    myHand,
    dealKey,
    settlementResult,
    bidHistory,
    roomId,
    error,
    isReconnecting,
    reconnectDeadline,
    turnDeadline,
    hintCardIds,
    lastTrickPlays,
    autoPlaySeat,
    scorePopup,
    chatMessages,
    isTrustee,
    actions,
  } = useColyseus();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const mySeat = roomState?.players.find(p => p.id === myPlayerId)?.seatIndex ?? 0;

  if (!roomState || !myPlayerId) {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: '#fff', background: '#111', fontSize: 14,
      }}>
        连接中…
        <button
          onClick={() => window.history.back()}
          style={{ marginLeft: 16, padding: '6px 14px', fontSize: 12, borderRadius: 6,
            background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer' }}
        >返回</button>
      </div>
    );
  }

  const handleToggle = (card: any) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111' }}>
      <TableV4Adapter
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
        onCardToggle={handleToggle}
        onSelectionChange={setSelectedIds}
        onAction={() => {}}
        roomId={roomId}
        error={error}
        isReconnecting={isReconnecting}
        reconnectDeadline={reconnectDeadline}
        turnDeadline={turnDeadline}
        hintCardIds={hintCardIds}
        lastTrickPlays={lastTrickPlays}
        autoPlaySeat={autoPlaySeat}
        scorePopup={scorePopup}
        chatMessages={chatMessages}
        availableSuits={[]}
        selectedCount={selectedIds.size}
        isMyTurn={roomState.currentTurn === mySeat}
        settlementResult={settlementResult}
        bidHistory={bidHistory}
        onLeave={actions.leaveRoom}
        onHint={actions.sendHint}
        onDiscardHint={actions.sendDiscardHint}
        onChat={actions.sendChat}
        onClearSelection={() => setSelectedIds(new Set())}
        onReturnToLobby={actions.returnToLobby}
        selectedPattern=""
        isTrustee={isTrustee}
        onResumeControl={actions.resumeControl}
        playerLimit={roomState.modePlayerCount}
        history={roomState.history}
        roundsPlayed={roomState.roundsPlayed}
        discardCount={roomState.bottomCount}
        onAddAi={actions.addAi}
        onRemoveAi={actions.removeAi}
        onKickPlayer={actions.kickPlayer}
      />
    </div>
  );
}
