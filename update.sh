set -e

cd $HOME/z3
git pull
rm -rf build
rm -rf $HOME/z3-install
CXX=clang++ CC=clang python scripts/mk_make.py --prefix=$HOME/z3-install
cd build
make -j32
make install

cd $HOME/llvm-project
git pull
rm -rf build
mkdir build
cd build
cmake -G Ninja -DLLVM_ENABLE_RTTI=ON -DLLVM_ENABLE_EH=ON -DLLVM_BUILD_LLVM_DYLIB=ON -DCMAKE_BUILD_TYPE=Release  -DLLVM_ENABLE_ASSERTIONS=ON -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_INSTALL_PREFIX=$HOME/llvm-install ../llvm -DLLVM_ENABLE_PROJECTS="clang"
ninja
ninja check
ninja install

cd $HOME/alive2
git pull
rm -rf build-new
mkdir build-new
cd build-new
cmake .. -G Ninja -DCLANG_PLUGIN=1 -DBUILD_TV=1 -DBUILD_LLVM_UTILS=1 -DLLVM_DIR=$HOME/llvm-install/lib/cmake/llvm -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release
ninja
ninja check || true # some cases always fail

cd $HOME

echo
echo
echo 'Success: now move build-new to build'
echo
