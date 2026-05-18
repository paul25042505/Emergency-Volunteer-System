#!/usr/bin/perl
use strict;
use IO::Socket::INET;
use POSIX qw(strftime);
use File::Basename;

my $port = $ARGV[0] || 8080;
my $root = $ARGV[1] || '.';

my %mime = (
  html => 'text/html; charset=utf-8',
  htm  => 'text/html; charset=utf-8',
  css  => 'text/css',
  js   => 'application/javascript',
  json => 'application/json',
  png  => 'image/png',
  jpg  => 'image/jpeg',
  jpeg => 'image/jpeg',
  gif  => 'image/gif',
  svg  => 'image/svg+xml',
  ico  => 'image/x-icon',
  woff => 'font/woff',
  woff2=> 'font/woff2',
  ttf  => 'font/ttf',
  map  => 'application/json',
);

my $server = IO::Socket::INET->new(
  LocalPort => $port,
  Type      => SOCK_STREAM,
  Reuse     => 1,
  Listen    => 20,
) or die "Cannot bind port $port: $!\n";

print "Serving $root on http://localhost:$port\n";
$| = 1;

while (my $client = $server->accept()) {
  my $req = <$client>;
  next unless defined $req;
  $req =~ s/\r\n//;
  # drain headers
  while (my $h = <$client>) { last if $h =~ /^\r?\n$/; }

  my (undef, $path) = split(/\s+/, $req);
  $path =~ s/\?.*//;
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  $path = '/' if !defined $path || $path eq '';

  my $file = $root . $path;
  $file .= '/index.html' if -d $file;
  $file =~ s|/+|/|g;

  if (-f $file) {
    open(my $fh, '<:raw', $file) or do {
      print $client "HTTP/1.0 403 Forbidden\r\nContent-Length: 9\r\n\r\nForbidden";
      close $client; next;
    };
    my @data = <$fh>;
    close $fh;
    my $body = join('', @data);
    my ($ext) = $file =~ /\.(\w+)$/;
    my $ct = $mime{lc($ext||'')} || 'application/octet-stream';
    print $client "HTTP/1.0 200 OK\r\nContent-Type: $ct\r\nContent-Length: " . length($body) . "\r\n\r\n$body";
  } else {
    my $msg = "Not Found: $path";
    print $client "HTTP/1.0 404 Not Found\r\nContent-Length: " . length($msg) . "\r\n\r\n$msg";
  }
  close $client;
}
