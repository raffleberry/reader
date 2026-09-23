<template>
  <RouterView />
</template>

<style>
.reader-frame {
  position: relative;
  height: calc(100vh - 320px);
  min-height: 400px;
  overflow: hidden;
}
/* EpubView's root (.reader) is absolutely positioned with a 50px inset
   meant for its own full-page layout. Pin it to our frame instead,
   otherwise it escapes and positions against the viewport. */
.reader-frame > div.reader {
  position: absolute;
  inset: 0;
}
</style>
