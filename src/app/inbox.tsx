import { PlaceholderScreen } from '@/components/placeholder-screen';

// Incoming message requests (accept/decline) and accepted chats (Phases 2 & 4).
export default function InboxScreen() {
  return (
    <PlaceholderScreen
      icon={{
        ios: 'bubble.left.and.bubble.right.fill',
        android: 'chat',
        web: 'chat',
      }}
      title="Inbox"
      phase="coming in phases 2 & 4"
      description={
        'Message requests land here for you to accept or decline. Chats only ' +
        'open once you accept — no one can message you without your say-so.'
      }
    />
  );
}
