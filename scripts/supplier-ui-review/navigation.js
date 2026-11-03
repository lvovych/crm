let navigating = false;
const useRouter = () => ({ push: (url) => {
  navigating = true;
  location.assign(url);
}, refresh: () => {
  if (!navigating) location.reload();
}, back: () => history.back() });
export {
  useRouter
};
