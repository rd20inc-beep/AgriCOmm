import SlideDrawer from '../../../components/SlideDrawer';

// Drop-in replacement for the shared <Modal> in the Admin tabs: same props
// (isOpen/onClose/title/children/size/footer) but renders as a right-side
// SlideDrawer instead of a centered dialog — matching the app's drawer convention.
// Only the Admin tabs use this; the global Modal is unchanged elsewhere.
const SIZE_MAP = { sm: 'md', md: 'lg', lg: 'xl', xl: 'xl', full: 'xl' };

export default function AdminDrawer({ isOpen, onClose, title, children, size = 'md', footer }) {
  return (
    <SlideDrawer open={isOpen} onClose={onClose} title={title} size={SIZE_MAP[size] || 'lg'} footer={footer}>
      {children}
    </SlideDrawer>
  );
}
