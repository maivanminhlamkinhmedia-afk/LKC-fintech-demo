/* Reviewed source candidate only. Must run under the exact profile in BOTH images.
 * No remote address is contacted; denial is tested at socket creation.
 * A PASS is evidence of this process context, never authorization for a database.
 */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <sys/prctl.h>
#include <sys/utsname.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if !defined(__x86_64__) || defined(__ILP32__)
#error "The candidate admits x86_64 native ABI only"
#endif

static int blocked_errno(int code) { return code == EPERM || code == EACCES; }
static int fail(void) {
  /* Never emit strerror, process environment, paths, descriptors or raw errors. */
  puts("{\"kind\":\"CMS_S1_NETWORK_CANARY_V1\",\"pass\":false}");
  return 1;
}
static int denied_socket(int family) {
  int fd, saved, pair[2];
  errno = 0; fd = socket(family, SOCK_STREAM | SOCK_CLOEXEC, 0); saved = errno;
  if (fd >= 0) { close(fd); return 0; }
  if (!blocked_errno(saved)) return 0; /* EAFNOSUPPORT / ENOSYS never count. */
  errno = 0; fd = socketpair(family, SOCK_STREAM | SOCK_CLOEXEC, 0, pair); saved = errno;
  if (fd == 0) { close(pair[0]); close(pair[1]); return 0; }
  return blocked_errno(saved);
}
static int unix_positive(void) {
  int pair[2]; char in = 'a', out = 0;
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, pair) != 0) return 0;
  int ok = write(pair[0], &in, 1) == 1 && read(pair[1], &out, 1) == 1 && out == in;
  close(pair[0]); close(pair[1]);
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return 0;
  close(fd); return ok;
}
static int proc_controls(void) {
  FILE *file = fopen("/proc/self/status", "re");
  char line[256]; int seccomp = -1, nnp = -1, capeff_seen = 0, capbnd_seen = 0;
  unsigned long long capeff = 1, capbnd = 1;
  if (!file) return 0;
  while (fgets(line, sizeof(line), file)) {
    if (sscanf(line, "Seccomp:%d", &seccomp) == 1) continue;
    if (sscanf(line, "NoNewPrivs:%d", &nnp) == 1) continue;
    if (sscanf(line, "CapEff:%llx", &capeff) == 1) capeff_seen = 1;
    if (sscanf(line, "CapBnd:%llx", &capbnd) == 1) capbnd_seen = 1;
  }
  int ok = !ferror(file) && seccomp == 2 && nnp == 1 && capeff_seen && capbnd_seen && capeff == 0 && capbnd == 0;
  fclose(file); return ok;
}
static int no_inherited_network(void) {
  DIR *dir = opendir("/proc/self/fd"); struct dirent *item;
  if (!dir) return 0;
  int own_fd = dirfd(dir), count = 0, ok = 1;
  while ((item = readdir(dir))) {
    char *end = NULL; errno = 0; long value = strtol(item->d_name, &end, 10);
    if (errno || !end || *end || value < 0 || value > 1048576 || value == own_fd) continue;
    if (++count > 4096) { ok = 0; break; }
    int family = -1; socklen_t size = sizeof(family);
    if (getsockopt((int)value, SOL_SOCKET, SO_DOMAIN, &family, &size) == 0) {
      /* Any inherited socket must be Unix, not just IPv4/IPv6. */
      if (size != sizeof(family) || family != AF_UNIX) { ok = 0; break; }
    } else if (errno != ENOTSOCK) { ok = 0; break; }
  }
  closedir(dir); return ok;
}
static long compat_call(unsigned int number, unsigned long a, unsigned long b, unsigned long c) {
  long result;
  __asm__ volatile ("int $0x80" : "=a" (result) : "0" ((unsigned long)number), "b" (a), "c" (b), "d" (c) : "memory");
  return (long)(int32_t)result;
}
static int alternate_child(int which) {
  errno = 0; long result;
  if (which == 0) {
    result = syscall(0x40000000UL + SYS_socket, AF_INET, SOCK_STREAM, 0);
    return result < 0 && blocked_errno(errno);
  }
  if (which == 1) {
    result = compat_call(359, AF_INET, SOCK_STREAM, 0); /* i386 direct socket */
  } else {
    unsigned long args[3] = { AF_INET, SOCK_STREAM, 0 };
    result = compat_call(102, 1, (unsigned long)args, 0); /* i386 socketcall */
  }
  return result == -EPERM || result == -EACCES;
}
static int alternate_denied(void) {
  for (int which = 0; which < 3; which++) {
    pid_t child = fork(); if (child < 0) return 0;
    if (child == 0) _exit(alternate_child(which) ? 0 : 1);
    int status; if (waitpid(child, &status, 0) != child) return 0;
    /* libseccomp may terminate an unlisted ABI with SIGSYS; that is a denial. */
    if (!(WIFEXITED(status) && WEXITSTATUS(status) == 0) && !(WIFSIGNALED(status) && WTERMSIG(status) == SIGSYS)) return 0;
  }
  return 1;
}
static int io_uring_denied(void) {
  /* Pass invalid args deliberately: filtering must reject BEFORE kernel validation. */
  errno = 0; long result = syscall(425, 1, NULL); if (result >= 0 || !blocked_errno(errno)) return 0;
  errno = 0; result = syscall(426, -1, 0, 0, 0, NULL, 0); if (result >= 0 || !blocked_errno(errno)) return 0;
  errno = 0; result = syscall(427, -1, 0, NULL, 0); return result < 0 && blocked_errno(errno);
}
int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) return fail();
  struct utsname machine;
  if (uname(&machine) || strcmp(machine.machine, "x86_64") || !proc_controls() || !no_inherited_network() || !unix_positive()) return fail();
  int denied = 0;
  for (int family = 0; family <= 45; family++) {
    if (family == AF_UNIX) continue;
    if (!denied_socket(family)) return fail();
    denied++;
  }
  if (!denied_socket(9999) || !alternate_denied() || !io_uring_denied() || denied != 45) return fail();
  puts("{\"kind\":\"CMS_S1_NETWORK_CANARY_V1\",\"architecture\":\"x86_64\",\"seccomp\":2,\"noNewPrivileges\":1,\"capEffZero\":true,\"capBndZero\":true,\"inheritedInetZero\":true,\"unixPass\":true,\"deniedFamilies\":45,\"alternateAbiDenied\":true,\"ioUringDenied\":true,\"pass\":true}");
  return 0;
}
