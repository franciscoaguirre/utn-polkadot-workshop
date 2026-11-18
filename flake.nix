{
  # Workshop environment for Nix / NixOS users. Instead of rustup and downloading
  # binaries into ./bin, run:
  #
  #   nix develop
  #   ./scripts/setup.sh
  #
  # The shell provides the pinned Rust toolchain (from rust-toolchain.toml),
  # Node.js 22 and the Polkadot binaries (polkadot-omni-node, eth-rpc,
  # chain-spec-builder), patched to run on NixOS.
  description = "UTN governance pallet workshop";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, rust-overlay, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems =
        function:
        nixpkgs.lib.genAttrs systems (
          system:
          function (
            import nixpkgs {
              inherit system;
              overlays = [ rust-overlay.overlays.default ];
            }
          )
        );

      # Keep in sync with SDK_RELEASE in scripts/common.sh.
      sdkRelease = "polkadot-stable2609-2";

      # Parity publishes prebuilt binaries for these platforms only (sha256 from
      # the release's .sha256 files). Elsewhere, scripts/setup.sh builds them
      # from source with cargo.
      prebuilt = {
        x86_64-linux = {
          suffix = "";
          sha256 = {
            polkadot-omni-node = "2066854bdaf9a2cdfb4a331f9684953e4a8000a1aa96bb684e112f50fbc91c4e";
            eth-rpc = "e6a54b0d223c8e03654246cd5397ac58e5f41ad0da999c5885ec3652e7aee5fa";
            chain-spec-builder = "56d026da16a49c3106aeb5e45ffad7ae5bf4a13c1a250d32579a1575972470f0";
          };
        };
        aarch64-darwin = {
          suffix = "-aarch64-apple-darwin";
          sha256 = {
            polkadot-omni-node = "abb5b18beb1fdf148c117dcf7564336a3d80b3e83b19b9e6fe16060854ee4d41";
            eth-rpc = "6cfc2566670157b84693c1f636c70f015f278a73b7777331e61a4b6742b622b4";
            chain-spec-builder = "cc59d089dc27d30f16a2acf452a1ea6864182cf69995a803ae0f2bb22a082233";
          };
        };
      };

      polkadotBinaries =
        pkgs:
        let
          platform = prebuilt.${pkgs.stdenv.hostPlatform.system};
          fetchTool =
            tool:
            pkgs.fetchurl {
              url = "https://github.com/paritytech/polkadot-sdk/releases/download/${sdkRelease}/${tool}${platform.suffix}";
              sha256 = platform.sha256.${tool};
            };
        in
        pkgs.stdenv.mkDerivation {
          pname = "polkadot-workshop-binaries";
          version = sdkRelease;
          dontUnpack = true;
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
          # libstdc++ and libgcc_s; glibc comes from stdenv.
          buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
          installPhase = ''
            runHook preInstall
            install -Dm755 ${fetchTool "polkadot-omni-node"} $out/bin/polkadot-omni-node
            install -Dm755 ${fetchTool "eth-rpc"} $out/bin/eth-rpc
            install -Dm755 ${fetchTool "chain-spec-builder"} $out/bin/chain-spec-builder
            runHook postInstall
          '';
          meta.platforms = builtins.attrNames prebuilt;
        };

      hasPrebuilt = pkgs: prebuilt ? ${pkgs.stdenv.hostPlatform.system};
    in
    {
      packages = forAllSystems (
        pkgs: pkgs.lib.optionalAttrs (hasPrebuilt pkgs) { polkadot-binaries = polkadotBinaries pkgs; }
      );

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml)
            pkgs.nodejs_22
            pkgs.curl
            pkgs.git
            # Publishes the shared class chain (scripts/start-shared-chain.sh).
            pkgs.cloudflared
          ]
          ++ (
            if hasPrebuilt pkgs then
              [ (polkadotBinaries pkgs) ]
            else
              # No prebuilt binaries: setup.sh builds them with `cargo install`,
              # which needs these (RocksDB bindings, protobuf, TLS).
              [
                pkgs.clang
                pkgs.protobuf
                pkgs.pkg-config
                pkgs.openssl
              ]
          );

          # bindgen (used when building the node from source) needs libclang.
          LIBCLANG_PATH = "${pkgs.llvmPackages.libclang.lib}/lib";

          shellHook = ''
            echo "UTN workshop shell: $(rustc --version), node $(node --version)"
            echo "Next: ./scripts/setup.sh, then ./scripts/check.sh"
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
